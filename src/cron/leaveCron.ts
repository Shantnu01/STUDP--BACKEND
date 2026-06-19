import cron from 'node-cron'
import { db } from '../config/firebase'

/**
 * Run every day at 3:00 AM server time.
 * Deletes leave requests that are older than 10 days based on 'applied_at'.
 */
export const startLeaveCleanupCron = () => {
  cron.schedule('0 3 * * *', async () => {
    console.log('[Cron] Starting leave requests cleanup...')
    
    try {
      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
      const threshold = tenDaysAgo.toISOString()

      const snap = await db.collection('leaveRequests')
        .where('applied_at', '<', threshold)
        .get()

      if (snap.empty) {
        console.log('[Cron] No expired leave requests to delete.')
        return
      }

      const batch = db.batch()
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref)
      })

      await batch.commit()
      console.log(`[Cron] Successfully deleted ${snap.size} expired leave requests.`)
    } catch (e) {
      console.error('[Cron] Error during leave requests cleanup:', e)
    }
  })
}
