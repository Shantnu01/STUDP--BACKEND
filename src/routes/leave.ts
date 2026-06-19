import { Router, Response } from 'express'
import { verifyToken, principalOnly, staffOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const LeaveRequestSchema = z.object({
  leave_type: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  reason: z.string().min(1),
})

export type LeaveRequestRecord = {
  id: string
  user_id: string
  user_name: string
  role: string
  school_id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string
  status: 'Pending' | 'Approved' | 'Rejected'
  applied_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

// POST /api/leave/apply (For Teachers/Staff)
router.post('/apply', ...staffOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = LeaveRequestSchema.parse(req.body)
    
    // Auth middleware ensures req.uid and req.schoolId exist for staff
    if (!req.uid || !req.schoolId) {
      return res.status(403).json({ error: 'User ID or School ID missing' })
    }

    // Fetch user name for denormalization
    const userDoc = await db.collection('users').doc(req.uid).get()
    let user_name = 'Unknown'
    if (userDoc.exists) {
      user_name = userDoc.data()?.name || userDoc.data()?.displayName || 'Unknown'
    }

    const payload: Omit<LeaveRequestRecord, 'id'> = {
      ...data,
      user_id: req.uid,
      user_name,
      role: req.role || 'teacher',
      school_id: req.schoolId,
      status: 'Pending',
      applied_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
    }

    const ref = await db.collection('leaveRequests').add(payload)
    res.status(201).json({ leaveRequest: { id: ref.id, ...payload } })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// GET /api/leave/principal (For Principals to list requests)
router.get('/principal', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.schoolId) {
      return res.status(403).json({ error: 'School ID missing' })
    }

    const snap = await db.collection('leaveRequests')
      .where('school_id', '==', req.schoolId)
      .get()

    let requests: LeaveRequestRecord[] = []
    snap.forEach((doc) => {
      requests.push({ id: doc.id, ...doc.data() } as LeaveRequestRecord)
    })

    // Sort by newest first
    requests.sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime())

    res.json({ leaveRequests: requests })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/leave/:id/status (For Principals to approve/reject)
router.patch('/:id/status', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body
    
    if (!status || !['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Approved or Rejected' })
    }

    const docRef = db.collection('leaveRequests').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: 'Leave request not found' })
    }

    const leaveData = doc.data() as LeaveRequestRecord
    
    // Ensure the principal belongs to the same school as the leave request
    if (req.role !== 'admin' && leaveData.school_id !== req.schoolId) {
      return res.status(403).json({ error: 'Unauthorized to modify this request' })
    }

    const updates = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: req.uid || null
    }

    await docRef.update(updates)
    
    res.json({ success: true, leaveRequest: { ...leaveData, ...updates } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
