import cron from 'node-cron'
import { db } from '../config/firebase'

// Run every day at 4:00 AM server time
export const startAttendanceCron = () => {
  cron.schedule('0 4 * * *', async () => {
    console.log('[Cron] Starting daily attendance auto-increment...')
    try {
      const summariesSnap = await db.collection('attendanceSummary').get()
      
      const batch = db.batch()
      let totalUpdates = 0

      for (const doc of summariesSnap.docs) {
        const data = doc.data()
        const counts = data.counts ?? {}
        
        let modified = false
        const nextCounts = Object.fromEntries(
          Object.entries(counts).map(([entityId, value]: [string, any]) => {
            modified = true
            return [
              entityId,
              {
                presentDays: value.presentDays ?? 0,
                totalWorkingDays: (value.totalWorkingDays ?? 0) + 1,
              },
            ]
          })
        )

        if (modified) {
          batch.set(
            doc.ref,
            {
              counts: nextCounts,
              updatedAt: new Date().toISOString(),
              updatedBy: 'system-cron',
            },
            { merge: true }
          )
          totalUpdates++
        }
      }

      if (totalUpdates > 0) {
        await batch.commit()
      }
      
      console.log(`[Cron] Successfully advanced working days for ${totalUpdates} attendance documents.`)
    } catch (e) {
      console.error('[Cron] Error during daily attendance auto-increment:', e)
    }
  })
}
