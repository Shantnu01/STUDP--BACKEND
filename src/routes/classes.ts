import { Router, Response } from 'express'
import { principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const ClassSchema = z.object({
  name: z.string().min(1),
  section: z.string().default('A'),
  grade: z.string().min(1),
  classTeacher: z.string().optional(),
  studentCount: z.number().int().min(0).default(0),
})

type ClassRecord = z.infer<typeof ClassSchema> & {
  id: string
  schoolId?: string
}

function getGradeRank(value: string = '') {
  const match = value.match(/\d+/)
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER
}

function sortClasses(items: ClassRecord[]) {
  return [...items].sort((a, b) =>
    getGradeRank(a.grade) - getGradeRank(b.grade) ||
    (a.grade || '').localeCompare(b.grade || '') ||
    (a.section || '').localeCompare(b.section || '') ||
    a.name.localeCompare(b.name),
  )
}

// GET /api/classes
router.get('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    let snap

    if (req.role === 'admin' && !req.schoolId) {
      snap = await db.collection('classes').get()
    } else {
      if (!req.schoolId) {
        return res.status(403).json({ error: 'School ID missing' })
      }
      snap = await db.collection('classes').where('schoolId', '==', req.schoolId).get()
    }

    const classes = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as z.infer<typeof ClassSchema>) })) as ClassRecord[]
    res.json({ classes: sortClasses(classes) })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/classes
router.post('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = ClassSchema.parse(req.body)
    const schoolId = req.schoolId || req.body.schoolId

    if (!schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const ref = await db.collection('classes').add({
      ...data,
      schoolId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    res.status(201).json({ id: ref.id, ...data })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

export default router
