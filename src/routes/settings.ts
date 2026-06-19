import { Router, Response } from 'express'
import { db } from '../config/firebase'
import { principalOnly, AuthRequest } from '../middleware/auth'

const router = Router()

/**
 * GET /api/settings
 * Fetch school-wide settings including location and attendance radius.
 * Accessible to authenticated school staff.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId
    if (!schoolId) return res.status(400).json({ error: 'School ID missing' })

    const schoolDoc = await db.collection('schools').doc(schoolId).get()
    if (!schoolDoc.exists) return res.status(404).json({ error: 'School not found' })

    const data = schoolDoc.data()
    res.json({
      location: data?.location || null,
      attendanceRadius: data?.attendanceRadius || 200, // Default 200 meters
      automatedAttendance: data?.automatedAttendance ?? false,
      workingHours: data?.workingHours || { start: '08:00', end: '16:00' }
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/settings
 * Update school configuration. Only the Principal can change these.
 */
router.patch('/', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolId
    if (!schoolId) return res.status(400).json({ error: 'School ID missing' })
    const { location, attendanceRadius, automatedAttendance, workingHours } = req.body

    const updateData: any = {}
    
    // Validate and add location if provided
    if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
      updateData.location = {
        lat: location.lat,
        lng: location.lng
      }
    }
    
    if (typeof attendanceRadius === 'number') {
      updateData.attendanceRadius = attendanceRadius
    }
    
    if (typeof automatedAttendance === 'boolean') {
      updateData.automatedAttendance = automatedAttendance
    }

    if (workingHours) {
      updateData.workingHours = workingHours
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    await db.collection('schools').doc(schoolId).update({
      ...updateData,
      updatedAt: new Date().toISOString()
    })

    res.json({ message: 'School settings updated successfully', settings: updateData })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

export default router
