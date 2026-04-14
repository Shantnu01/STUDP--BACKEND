import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { auth, db } from '../config/firebase'
import { z } from 'zod'
import { checkSchoolLimits } from '../utils/limits'

const router = Router()

const TeacherStatusSchema = z.enum(['active', 'on-leave', 'inactive'])

const BaseTeacherSchema = z.object({
  name: z.string().min(2),
  subject: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(3, "Phone number requires at least 3 digits"),
  gender: z.string().optional(),
  classes: z.array(z.string()).optional(),
  classesRaw: z.string().optional(),
  status: TeacherStatusSchema.default('active'),
}).passthrough()

const TeacherSchema = BaseTeacherSchema

type TeacherInput = z.infer<typeof TeacherSchema>
type TeacherRecord = TeacherInput & {
  id: string
  schoolId?: string
  createdAt?: string
  updatedAt?: string
}

function normalizeClasses(data: TeacherInput) {
  if (Array.isArray(data.classes) && data.classes.length > 0) {
    return data.classes.map((item: any) => item.trim()).filter(Boolean)
  }

  if (data.classesRaw) {
    return data.classesRaw.split(',').map((item: any) => item.trim()).filter(Boolean)
  }

  return []
}

function normalizeTeacherPayload(data: TeacherInput, schoolId: string) {
  return {
    ...data,
    classes: normalizeClasses(data),
    schoolId,
  }
}

function sortTeachers(items: TeacherRecord[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

async function listTeachersForSchool(schoolId: string): Promise<TeacherRecord[]> {
  const snap = await db.collection('teachers').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) })) as TeacherRecord[]
}

async function updateTeacher(req: AuthRequest, res: Response) {
  try {
    const data = BaseTeacherSchema.partial().parse(req.body)
    const docRef = db.collection('teachers').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Teacher not found' })

    const existing = { id: doc.id, ...(doc.data() as TeacherInput & { schoolId?: string }) }
    if (req.role !== 'admin' && existing.schoolId !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const schoolId = existing.schoolId || req.schoolId || req.body.schoolId
    if (!schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const mergedInput = {
      ...existing,
      ...data,
    } as TeacherInput

    const payload = {
      ...normalizeTeacherPayload(mergedInput, schoolId),
      updatedAt: new Date().toISOString(),
    }

    await docRef.update(payload)
    res.json({ teacher: { id: req.params.id, ...payload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
}

router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (req.role === 'admin' && !req.schoolId) {
      const snap = await db.collection('teachers').get()
      const teachers = snap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as TeacherInput) })) as TeacherRecord[]
      return res.json({ teachers: sortTeachers(teachers) })
    }

    if (!req.schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const teachers = await listTeachersForSchool(req.schoolId)
    res.json({ teachers: sortTeachers(teachers) })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.body.schoolId

    if (!schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    // ENFORCE PLAN LIMIT
    try {
      await checkSchoolLimits(schoolId, 1)
    } catch (limitErr: any) {
      return res.status(403).json({ error: limitErr.message })
    }

    const data = TeacherSchema.parse(req.body)

    // Password Generation Logic
    const cleanName = data.name.replace(/\s+/g, '')
    // Fallback if name is under 3 chars handles it correctly via substring edge capability
    const first3Name = cleanName.substring(0, 3)
    const last3Name = cleanName.substring(Math.max(0, cleanName.length - 3))
    
    const cleanPhone = data.phone.replace(/\D/g, '')
    const phoneExt = cleanPhone.length >= 3 
      ? cleanPhone.substring(cleanPhone.length - 3) 
      : cleanPhone.padStart(3, '0').substring(0, 3)
      
    const dynamicPassword = `${first3Name}${phoneExt}${last3Name}`

    // Provision Firebase User Identity natively
    let userRecord
    try {
      userRecord = await auth.createUser({
        email: data.email || undefined,
        password: dynamicPassword,
        displayName: data.name,
      })
    } catch (authErr: any) {
      return res.status(400).json({ error: 'Failed to create auth identity: ' + authErr.message })
    }

    const now = new Date().toISOString()
    const payload = {
      ...normalizeTeacherPayload(data, schoolId),
      uid: userRecord.uid,
      role: 'teacher',
      createdAt: now,
      updatedAt: now,
    }

    const ref = await db.collection('teachers').add(payload)

    // Parallel provision to 'users' collection for strict Security Rules mapping
    await db.collection('users').doc(userRecord.uid).set({
      role: 'teacher',
      schoolId,
      displayName: data.name,
      email: data.email,
      status: data.status || 'active',
      updatedAt: now,
    }, { merge: true })

    res.status(201).json({ 
      teacher: { id: ref.id, ...payload }, 
      generatedPassword: dynamicPassword 
    })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

router.patch('/:id', ...principalOnly, updateTeacher)
router.put('/:id', ...principalOnly, updateTeacher)

// DELETE /api/teachers/:id
router.delete('/:id', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const docRef = db.collection('teachers').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Teacher not found' })

    const existing = doc.data() as TeacherInput & { schoolId?: string, uid?: string }
    if (req.role !== 'admin' && existing.schoolId !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    // Completely revoke login access by deleting Firebase Auth & the corresponding Users mapping
    if (existing.uid) {
      try {
        await auth.deleteUser(existing.uid)
      } catch (authErr) {
        console.warn('Failed to delete auth user, they might already be removed:', authErr)
      }
      try {
        await db.collection('users').doc(existing.uid).delete()
      } catch (userErr) {
        console.warn('Failed to delete user doc:', userErr)
      }
    }

    // Finally delete the teacher record itself
    await docRef.delete()
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
