import { Router, Response } from 'express'
import { staffOnly, principalOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const AttendanceSchema = z.object({
  classId: z.string(),
  date: z.string(),
  isPresent: z.record(z.string(), z.boolean()),
})

const SummaryScopeSchema = z.enum(['students', 'teachers', 'staff'])

type SummaryScope = z.infer<typeof SummaryScopeSchema>

function buildAttendanceId(schoolId: string, classId: string, date: string) {
  return `${schoolId}__${classId}__${date}`
}

function buildSummaryDocId(schoolId: string, scope: SummaryScope) {
  return `${schoolId}__${scope}`
}

function resolveSchoolId(req: AuthRequest) {
  return req.schoolId || (typeof req.query.schoolId === 'string' ? req.query.schoolId : '') || (typeof req.body.schoolId === 'string' ? req.body.schoolId : '')
}

// GET /api/attendance
router.get('/', ...staffOnly, async (req: AuthRequest, res: Response) => {
  try {
    const classId = typeof req.query.classId === 'string' ? req.query.classId : ''
    const date = typeof req.query.date === 'string' ? req.query.date : ''
    if (!classId || !date) return res.status(400).json({ error: 'classId and date required' })

    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    const doc = await db.collection('attendance').doc(buildAttendanceId(schoolId, classId, date)).get()
    if (!doc.exists) return res.json({ attendance: null })

    res.json({ attendance: { id: doc.id, ...doc.data() } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/attendance - record attendance
router.post('/', ...staffOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = AttendanceSchema.parse(req.body)
    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    if (data.classId === 'students') {
      return res.status(403).json({ error: 'Student attendance is strictly view-only from the portal. Edits are forbidden.' })
    }

    const serverToday = new Date().toISOString().split('T')[0]
    if (data.date !== serverToday) {
      return res.status(403).json({ error: 'Attendance can only be edited for the current day. Past dates are locked permanently.' })
    }

    const docId = buildAttendanceId(schoolId, data.classId, data.date)
    const docRef = db.collection('attendance').doc(docId)
    const existing = await docRef.get()
    const now = new Date().toISOString()

    await docRef.set({
      ...data,
      schoolId,
      updatedAt: now,
      updatedBy: req.uid,
      ...(existing.exists ? {} : { createdAt: now, createdBy: req.uid }),
    }, { merge: true })

    res.status(existing.exists ? 200 : 201).json({ id: docId, ...data })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// GET /api/attendance/summary?scope=students|teachers|staff
router.get('/summary', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const scope = SummaryScopeSchema.parse(req.query.scope)
    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    const doc = await db.collection('attendanceSummary').doc(buildSummaryDocId(schoolId, scope)).get()
    res.json({
      scope,
      counts: doc.exists ? (doc.data()?.counts ?? {}) : {},
    })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// POST /api/attendance/summary/mark
router.post('/summary/mark', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { scope, entityId } = z.object({
      scope: SummaryScopeSchema,
      entityId: z.string().min(1),
    }).parse(req.body)

    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    const docRef = db.collection('attendanceSummary').doc(buildSummaryDocId(schoolId, scope))
    const snapshot = await docRef.get()
    const counts = (snapshot.data()?.counts ?? {}) as Record<string, { presentDays?: number; totalWorkingDays?: number }>
    const current = counts[entityId] ?? { presentDays: 0, totalWorkingDays: 0 }

    counts[entityId] = {
      presentDays: (current.presentDays ?? 0) + 1,
      totalWorkingDays: (current.totalWorkingDays ?? 0) + 1,
    }

    await docRef.set({
      schoolId,
      scope,
      counts,
      updatedAt: new Date().toISOString(),
      updatedBy: req.uid,
      ...(snapshot.exists ? {} : { createdAt: new Date().toISOString(), createdBy: req.uid }),
    }, { merge: true })

    res.json({ scope, entityId, counts: counts[entityId] })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// POST /api/attendance/summary/advance-day
router.post('/summary/advance-day', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { scope } = z.object({
      scope: SummaryScopeSchema,
    }).parse(req.body)

    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    const docRef = db.collection('attendanceSummary').doc(buildSummaryDocId(schoolId, scope))
    const snapshot = await docRef.get()
    const counts = (snapshot.data()?.counts ?? {}) as Record<string, { presentDays?: number; totalWorkingDays?: number }>

    const nextCounts = Object.fromEntries(
      Object.entries(counts).map(([entityId, value]) => [
        entityId,
        {
          presentDays: value.presentDays ?? 0,
          totalWorkingDays: (value.totalWorkingDays ?? 0) + 1,
        },
      ]),
    )

    await docRef.set({
      schoolId,
      scope,
      counts: nextCounts,
      updatedAt: new Date().toISOString(),
      updatedBy: req.uid,
      ...(snapshot.exists ? {} : { createdAt: new Date().toISOString(), createdBy: req.uid }),
    }, { merge: true })

    res.json({ scope, counts: nextCounts })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// POST /api/attendance/summary/batch-save
router.post('/summary/batch-save', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { activeDate, updates } = z.object({
      activeDate: z.string(), // YYYY-MM-DD
      updates: z.array(z.object({
        scope: z.enum(['teachers', 'staff']),
        statuses: z.record(z.string(), z.enum(['present', 'absent'])),
      }))
    }).parse(req.body)

    const schoolId = resolveSchoolId(req)
    if (!schoolId) return res.status(403).json({ error: 'School ID missing' })

    await db.runTransaction(async (t) => {
      // 1. Perform ALL reads first
      const snaps = [];
      for (const update of updates) {
        const summaryRef = db.collection('attendanceSummary').doc(buildSummaryDocId(schoolId, update.scope as SummaryScope));
        snaps.push({ update, summaryRef, snap: await t.get(summaryRef) });
      }

      // 2. Perform ALL writes
      for (const { update, summaryRef, snap } of snaps) {
        const { scope, statuses } = update;
        const dailyRef = db.collection('attendance').doc(`${schoolId}__${scope}__${activeDate}`);
        const counts = (snap.data()?.counts ?? {}) as Record<string, { presentDays?: number; totalWorkingDays?: number }>;

        for (const [entityId, status] of Object.entries(statuses)) {
          if (!counts[entityId]) counts[entityId] = { presentDays: 0, totalWorkingDays: 0 };
          
          if (status === 'present') {
            counts[entityId].presentDays = (counts[entityId].presentDays ?? 0) + 1;
          }
        }

        t.set(summaryRef, {
          schoolId, scope, counts,
          updatedAt: new Date().toISOString(),
          updatedBy: req.uid,
        }, { merge: true });

        t.set(dailyRef, {
          schoolId, scope, date: activeDate, statuses,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
    })

    res.json({ success: true })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

export default router
