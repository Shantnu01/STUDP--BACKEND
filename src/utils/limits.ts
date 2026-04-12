import { db } from '../config/firebase'

/**
 * checkSchoolLimits
 * Returns the current count and the plan limit for a school.
 * Throws an error if the limit is exceeded.
 */
export async function checkSchoolLimits(schoolId: string, increment: number = 1) {
  const [schoolDoc, studentsSnap, teachersSnap, staffSnap] = await Promise.all([
    db.collection('schools').doc(schoolId).get(),
    db.collection('students').where('schoolId', '==', schoolId).get(),
    db.collection('teachers').where('schoolId', '==', schoolId).get(),
    db.collection('staff').where('schoolId', '==', schoolId).get(),
  ])

  if (!schoolDoc.exists) {
    throw new Error('School profile not found.')
  }

  const school = schoolDoc.data()
  const planId = school?.plan || 'Institutional Starter'
  
  // Fetch plan details
  const planDoc = await db.collection('plans').doc(planId).get()
  const planLimit = planDoc.exists ? planDoc.data()?.limit : 10 // Fallback to 10

  const currentCount = studentsSnap.size + teachersSnap.size + staffSnap.size
  
  if (currentCount + increment > planLimit) {
    throw new Error(`Plan Limit Reached: Your current plan (${planId}) only supports up to ${planLimit} members. Please upgrade to add more.`)
  }

  return { currentCount, planLimit }
}
