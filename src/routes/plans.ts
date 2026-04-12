import { Router, Response } from 'express'
import { adminOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const PlanSchema = z.object({
  price: z.number().min(0),
  limit: z.number().int().min(1),
  features: z.array(z.string()),
})

// GET /api/admin/plans - Fetch all plan configurations
router.get('/', ...adminOnly, async (_req, res: Response) => {
  try {
    const snap = await db.collection('plans').get()
    const plans = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    res.json({ plans })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/admin/plans/:id - Update a plan's configuration
router.put('/:id', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = PlanSchema.parse(req.body)
    await db.collection('plans').doc(req.params.id).set({
      ...data,
      updatedAt: new Date().toISOString()
    }, { merge: true })
    
    res.json({ id: req.params.id, ...data })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

export default router
