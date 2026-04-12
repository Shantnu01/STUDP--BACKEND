import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const DEFAULT_TOTALS = {
  teacher: 50000,
  staff: 30000,
} as const

const PaymentUpdateSchema = z.object({
  totalAmount: z.number().nonnegative(),
  amountToBePaid: z.number().nonnegative(),
  status: z.enum(['paid', 'pending']),
})

type PaymentType = 'teacher' | 'staff'

interface TeacherRecord {
  id: string
  name?: string
}

interface StaffRecord {
  id: string
  name?: string
}

interface PersonnelPaymentRecord {
  entityId?: string
  type?: PaymentType
  totalAmount?: number
  amountToBePaid?: number
  status?: 'paid' | 'pending'
  schoolId?: string
}

function getRecordId(schoolId: string, type: PaymentType, entityId: string) {
  return `${schoolId}__${type}__${entityId}`
}

async function getTeachersForSchool(schoolId: string): Promise<TeacherRecord[]> {
  const snap = await db.collection('teachers').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc) => {
    const data = doc.data() as TeacherRecord
    return { ...data, id: doc.id }
  }) as TeacherRecord[]
}

async function getStaffForSchool(schoolId: string): Promise<StaffRecord[]> {
  const snap = await db.collection('staff').where('schoolId', '==', schoolId).get()
  return snap.docs.map((doc) => {
    const data = doc.data() as StaffRecord
    return { ...data, id: doc.id }
  }) as StaffRecord[]
}

async function getPersonnelPaymentsForSchool(schoolId: string): Promise<Map<string, PersonnelPaymentRecord>> {
  const snap = await db.collection('personnelPayments').where('schoolId', '==', schoolId).get()
  return new Map(
    snap.docs.map((doc) => {
      const data = doc.data() as PersonnelPaymentRecord
      return [`${data.type}:${data.entityId}`, data] as [string, PersonnelPaymentRecord]
    }),
  )
}

router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.query.schoolId
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const [teachers, staff, payments] = await Promise.all([
      getTeachersForSchool(schoolId),
      getStaffForSchool(schoolId),
      getPersonnelPaymentsForSchool(schoolId),
    ])

    const records = [
      ...teachers.map((teacher) => {
        const record = payments.get(`teacher:${teacher.id}`)
        return {
          id: `teacher:${teacher.id}`,
          entityId: teacher.id,
          name: teacher.name || 'Unnamed Teacher',
          type: 'teacher' as const,
          totalAmount: record?.totalAmount ?? DEFAULT_TOTALS.teacher,
          amountToBePaid: record?.amountToBePaid ?? DEFAULT_TOTALS.teacher,
          status: record?.status ?? 'pending',
        }
      }),
      ...staff.map((member) => {
        const record = payments.get(`staff:${member.id}`)
        return {
          id: `staff:${member.id}`,
          entityId: member.id,
          name: member.name || 'Unnamed Staff Member',
          type: 'staff' as const,
          totalAmount: record?.totalAmount ?? DEFAULT_TOTALS.staff,
          amountToBePaid: record?.amountToBePaid ?? DEFAULT_TOTALS.staff,
          status: record?.status ?? 'pending',
        }
      }),
    ]

    res.json({ records })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.patch('/:type/:entityId', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId || req.body.schoolId
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const type = z.enum(['teacher', 'staff']).parse(req.params.type) as PaymentType
    const payload = PaymentUpdateSchema.parse(req.body)
    const collectionName = type === 'teacher' ? 'teachers' : 'staff'
    const entityDoc = await db.collection(collectionName).doc(req.params.entityId).get()

    if (!entityDoc.exists) return res.status(404).json({ error: `${type} not found` })
    const entity = entityDoc.data() as { schoolId?: string; name?: string }
    if (entity.schoolId !== schoolId && req.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const now = new Date().toISOString()
    await db.collection('personnelPayments').doc(getRecordId(schoolId, type, req.params.entityId)).set({
      schoolId,
      type,
      entityId: req.params.entityId,
      totalAmount: payload.totalAmount,
      amountToBePaid: payload.amountToBePaid,
      status: payload.status,
      updatedAt: now,
      updatedBy: req.uid,
    }, { merge: true })

    res.json({
      record: {
        id: `${type}:${req.params.entityId}`,
        entityId: req.params.entityId,
        name: entity.name || 'Unnamed',
        type,
        totalAmount: payload.totalAmount,
        amountToBePaid: payload.amountToBePaid,
        status: payload.status,
      },
    })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

export default router
