import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'
import { checkSchoolLimits } from '../utils/limits'

const router = Router()

const BaseStaffSchema = z.object({
  name: z.string().min(2),
  age: z.coerce.number().int().min(0).optional(),
  work: z.string().optional(),
  role: z.string().optional(),
  contact: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  department: z.string().optional(),
  salary: z.coerce.number().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
}).passthrough()

const StaffSchema = BaseStaffSchema.superRefine((value: any, ctx: any) => {
  if (!(value.work || value.role)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Work or role is required',
      path: ['work'],
    })
  }
})

type StaffInput = z.infer<typeof StaffSchema>
type StaffRecord = StaffInput & {
  id: string
  schoolId?: string
  createdAt?: string
  updatedAt?: string
}

function sortStaff(items: StaffRecord[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeStaffPayload(data: StaffInput, schoolId: string) {
  const work = data.work || data.role || ''
  const contact = data.contact || data.phone || ''

  return {
    ...data,
    work,
    role: work,
    contact,
    phone: contact,
    address: data.address || '',
    department: data.department || '',
    schoolId,
    status: data.status || 'active',
  }
}

async function updateStaffMember(req: AuthRequest, res: Response) {
  try {
    const data = BaseStaffSchema.partial().parse(req.body)
    const docRef = db.collection('staff').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Staff member not found' })

    const existing = { id: doc.id, ...(doc.data() as StaffInput & { schoolId?: string }) }
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
    } as StaffInput

    const payload = {
      ...normalizeStaffPayload(mergedInput, schoolId),
      updatedAt: new Date().toISOString(),
    }

    await docRef.update(payload)
    res.json({ staff: { id: req.params.id, ...payload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
}

async function listStaffForSchool(schoolId: string) {
  const snap = await db.collection('staff').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as StaffInput & { schoolId?: string }) })) as StaffRecord[]
}

// GET /api/staff
router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (req.role === 'admin' && !req.schoolId) {
      const snap = await db.collection('staff').get()
      const staff = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as StaffInput) })) as StaffRecord[]
      return res.json({ staff: sortStaff(staff) })
    }

    if (!req.schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const staff = await listStaffForSchool(req.schoolId)
    res.json({ staff: sortStaff(staff) })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/staff
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

    const data = StaffSchema.parse(req.body)

    const now = new Date().toISOString()
    const payload = {
      ...normalizeStaffPayload(data, schoolId),
      createdAt: now,
      updatedAt: now,
    }

    const ref = await db.collection('staff').add(payload)
    res.status(201).json({ staff: { id: ref.id, ...payload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// PATCH /api/staff/:id
router.patch('/:id', ...principalOnly, updateStaffMember)

// PUT /api/staff/:id
router.put('/:id', ...principalOnly, updateStaffMember)

// DELETE /api/staff/:id
router.delete('/:id', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const docRef = db.collection('staff').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) return res.status(404).json({ error: 'Staff member not found' })

    const existing = doc.data() as StaffInput & { schoolId?: string }
    if (req.role !== 'admin' && existing.schoolId !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    await docRef.delete()
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
