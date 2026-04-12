import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const DEFAULT_FEE_AMOUNT = 10000
const DEFAULT_DUE = '2026-05-01'

const StudentFeeUpdateSchema = z.object({
  amount: z.number().nonnegative(),
  paid: z.number().nonnegative(),
  due: z.string().optional(),
})

const ClassFeeSchema = z.object({
  classId: z.string().min(1),
  amount: z.number().nonnegative(),
  due: z.string().optional(),
})

interface StudentRecord {
  id: string
  name?: string
  classId?: string
  section?: string
}

interface ClassFeeConfig {
  classId?: string
  amount?: number
  due?: string
  schoolId?: string
}

interface StudentFeeRecord {
  studentId?: string
  amount?: number
  paid?: number
  due?: string
  schoolId?: string
}

function getRecordId(schoolId: string, studentId: string) {
  return `${schoolId}__${studentId}`
}

function getClassConfigId(schoolId: string, classId: string) {
  return `${schoolId}__${classId}`
}

function computeStatus(paid: number, amount: number) {
  if (paid >= amount) return 'paid'
  if (paid > 0) return 'partial'
  return 'overdue'
}

async function getStudentsForSchool(schoolId: string): Promise<StudentRecord[]> {
  const snap = await db.collection('students').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc) => {
    const data = doc.data() as StudentRecord
    return { ...data, id: doc.id }
  }) as StudentRecord[]
}

async function getClassConfigsForSchool(schoolId: string): Promise<Map<string, ClassFeeConfig>> {
  const snap = await db.collection('feeClassConfigs').where('schoolId', '==', schoolId).get()
  return new Map(
    snap.docs.map((doc) => {
      const data = doc.data() as ClassFeeConfig
      return [data.classId || '', data] as [string, ClassFeeConfig]
    }),
  )
}

async function getFeeRecordsForSchool(schoolId: string): Promise<Map<string, StudentFeeRecord>> {
  const snap = await db.collection('studentFees').where('schoolId', '==', schoolId).get()
  return new Map(
    snap.docs.map((doc) => {
      const data = doc.data() as StudentFeeRecord
      return [data.studentId || '', data] as [string, StudentFeeRecord]
    }),
  )
}

router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.query.schoolId
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const [students, classConfigs, feeRecords] = await Promise.all([
      getStudentsForSchool(schoolId),
      getClassConfigsForSchool(schoolId),
      getFeeRecordsForSchool(schoolId),
    ])

    const fees = students.map((student) => {
      const classConfig = classConfigs.get(student.classId || '')
      const record = feeRecords.get(student.id)
      const amount = record?.amount ?? classConfig?.amount ?? DEFAULT_FEE_AMOUNT
      const paid = Math.min(record?.paid ?? 0, amount)
      const due = record?.due ?? classConfig?.due ?? DEFAULT_DUE

      return {
        id: student.id,
        studentId: student.id,
        student: student.name || 'Unnamed Student',
        classId: student.classId || '',
        section: student.section || '',
        amount,
        paid,
        due,
        status: computeStatus(paid, amount),
      }
    })

    res.json({ fees })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.patch('/:studentId', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.body.schoolId
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const payload = StudentFeeUpdateSchema.parse(req.body)
    const studentDoc = await db.collection('students').doc(req.params.studentId).get()
    if (!studentDoc.exists) return res.status(404).json({ error: 'Student not found' })

    const student = studentDoc.data() as StudentRecord & { schoolId?: string }
    if (student.schoolId !== schoolId && req.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const amount = Math.max(payload.amount, 0)
    const paid = Math.min(Math.max(payload.paid, 0), amount)
    const due = payload.due || DEFAULT_DUE
    const now = new Date().toISOString()

    await db.collection('studentFees').doc(getRecordId(schoolId, req.params.studentId)).set({
      schoolId,
      studentId: req.params.studentId,
      amount,
      paid,
      due,
      updatedAt: now,
      updatedBy: req.uid,
    }, { merge: true })

    res.json({
      fee: {
        id: req.params.studentId,
        studentId: req.params.studentId,
        student: student.name || 'Unnamed Student',
        classId: student.classId || '',
        section: student.section || '',
        amount,
        paid,
        due,
        status: computeStatus(paid, amount),
      },
    })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

router.post('/class-config', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.body.schoolId
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const payload = ClassFeeSchema.parse(req.body)
    const due = payload.due || DEFAULT_DUE
    const now = new Date().toISOString()

    await db.collection('feeClassConfigs').doc(getClassConfigId(schoolId, payload.classId)).set({
      schoolId,
      classId: payload.classId,
      amount: payload.amount,
      due,
      updatedAt: now,
      updatedBy: req.uid,
    }, { merge: true })

    const students = await getStudentsForSchool(schoolId)
    const targetStudents = students.filter((student) => student.classId === payload.classId)

    await Promise.all(targetStudents.map(async (student) => {
      const recordRef = db.collection('studentFees').doc(getRecordId(schoolId, student.id))
      const existing = await recordRef.get()
      const data = (existing.data() as StudentFeeRecord | undefined) || {}
      const paid = Math.min(data.paid ?? 0, payload.amount)

      return recordRef.set({
        schoolId,
        studentId: student.id,
        amount: payload.amount,
        paid,
        due,
        updatedAt: now,
        updatedBy: req.uid,
      }, { merge: true })
    }))

    res.json({ classId: payload.classId, amount: payload.amount, due })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

export default router
