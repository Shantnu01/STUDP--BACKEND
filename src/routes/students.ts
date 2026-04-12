import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'
import { checkSchoolLimits } from '../utils/limits'

const router = Router()

const StudentSchema = z.object({
  name: z.string().min(2),
  rollNo: z.string().min(1),
  classId: z.string().min(1),
  section: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  guardian: z.string().optional(),
  parentName: z.string().optional(),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
}).passthrough()

type StudentInput = z.infer<typeof StudentSchema>
type StudentRecord = StudentInput & {
  id: string
  studentId?: string
  schoolId?: string
  createdAt?: string
  updatedAt?: string
}

function getGradeRank(value: string = '') {
  const match = value.match(/\d+/)
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER
}

function sortStudents(items: StudentRecord[]) {
  return [...items].sort((a, b) =>
    getGradeRank(a.classId) - getGradeRank(b.classId) ||
    (a.classId || '').localeCompare(b.classId || '') ||
    (a.section || '').localeCompare(b.section || '') ||
    a.name.localeCompare(b.name),
  )
}

async function listStudentsForSchool(schoolId: string): Promise<StudentRecord[]> {
  const snap = await db.collection('students').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any), schoolId: doc.data().schoolId, studentId: doc.data().studentId })) as StudentRecord[]
}

async function syncStudentCounts(schoolId: string) {
  const students = await listStudentsForSchool(schoolId)
  const classCounts = new Map<string, number>()

  for (const student of students) {
    if (!student.classId) continue
    classCounts.set(student.classId, (classCounts.get(student.classId) ?? 0) + 1)
  }

  const classesSnap = await db.collection('classes').where('schoolId', '==', schoolId).get()
  await Promise.all(classesSnap.docs.map((doc) =>
    doc.ref.update({
      studentCount: classCounts.get(doc.data().name) ?? 0,
      updatedAt: new Date().toISOString(),
    }),
  ))

  await db.collection('schools').doc(schoolId).set({
    students: students.length,
    updatedAt: new Date().toISOString(),
  }, { merge: true })
}

function getNextStudentId(students: StudentRecord[]) {
  const year = new Date().getFullYear()
  const maxExisting = students.reduce((max, student) => {
    const match = student.studentId?.match(/^STU-\d{4}-(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  return `STU-${year}-${String(maxExisting + 1).padStart(5, '0')}`
}

function resolveSchoolId(req: AuthRequest, fallback?: string) {
  return req.schoolId || fallback || ''
}

// GET /api/students - list all students for the school
router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (req.role === 'admin' && !req.schoolId) {
      const snap = await db.collection('students').get()
      const students = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as StudentInput) })) as StudentRecord[]
      return res.json({ students: sortStudents(students) })
    }

    if (!req.schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    let query: any = db.collection('students').where('schoolId', '==', req.schoolId)
    if (typeof req.query.classId === 'string' && req.query.classId) {
      query = query.where('classId', '==', req.query.classId)
    }
    if (typeof req.query.section === 'string' && req.query.section) {
      query = query.where('section', '==', req.query.section)
    }

    const snap = await query.get()
    const students = snap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as StudentInput) })) as StudentRecord[]
    res.json({ students: sortStudents(students) })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/students - add student
router.post('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = resolveSchoolId(req, req.body.schoolId)

    if (!schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    // ENFORCE PLAN LIMIT
    try {
      await checkSchoolLimits(schoolId, 1)
    } catch (limitErr: any) {
      return res.status(403).json({ error: limitErr.message })
    }

    const data = StudentSchema.parse(req.body)

    const students = await listStudentsForSchool(schoolId)
    const duplicate = students.find((student) =>
      student.rollNo === data.rollNo &&
      student.classId === data.classId &&
      (student.section || '') === (data.section || ''),
    )

    if (duplicate) {
      return res.status(409).json({ error: 'A student with the same roll number already exists in this class and section.' })
    }

    const studentId = getNextStudentId(students)
    const now = new Date().toISOString()
    const payload = {
      ...data,
      section: data.section || '',
      studentId,
      schoolId,
      createdAt: now,
      updatedAt: now,
    }

    const ref = await db.collection('students').add(payload)
    await syncStudentCounts(schoolId)

    res.status(201).json({ student: { id: ref.id, ...payload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// PATCH /api/students/:id
router.patch('/:id', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = StudentSchema.partial().parse(req.body)
    const docRef = db.collection('students').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Student not found' })

    const existing = { id: doc.id, ...(doc.data() as StudentInput & { schoolId?: string; studentId?: string }) }
    if (req.role !== 'admin' && existing.schoolId !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const schoolId = existing.schoolId || resolveSchoolId(req, req.body.schoolId)
    if (!schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const merged = {
      ...existing,
      ...data,
      section: data.section ?? existing.section ?? '',
      updatedAt: new Date().toISOString(),
    }

    const students = await listStudentsForSchool(schoolId)
    const duplicate = students.find((student) =>
      student.id !== existing.id &&
      student.rollNo === merged.rollNo &&
      student.classId === merged.classId &&
      (student.section || '') === (merged.section || ''),
    )

    if (duplicate) {
      return res.status(409).json({ error: 'A student with the same roll number already exists in this class and section.' })
    }

    await docRef.update(merged)
    await syncStudentCounts(schoolId)

    const { id: _ignoredId, ...studentPayload } = merged
    res.json({ student: { id: req.params.id, ...studentPayload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// DELETE /api/students/:id
router.delete('/:id', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const docRef = db.collection('students').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Student not found' })

    const existing = doc.data() as StudentInput & { schoolId?: string }
    if (req.role !== 'admin' && existing.schoolId !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    await docRef.delete()

    if (existing.schoolId) {
      await syncStudentCounts(existing.schoolId)
    }

    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
