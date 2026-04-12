import { Request, Response, NextFunction } from 'express'
import { auth, db } from '../config/firebase'

export interface AuthRequest extends Request {
  uid?:      string
  email?:    string
  role?:     string
  schoolId?: string
  body: any
  params: any
  query: any
}

// Verify Firebase ID token
export async function verifyToken(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }
  try {
    const decoded = await auth.verifyIdToken(header.slice(7))
    req.uid   = decoded.uid
    req.email = decoded.email
    
    // Check if user has schoolId (for school staff)
    const userDoc = await db.collection('users').doc(req.uid).get()
    if (userDoc.exists) {
      const data = userDoc.data()
      req.role     = data?.role
      req.schoolId = data?.schoolId
    } else {
      // Check if user is super admin
      const adminDoc = await db.collection('admins').doc(req.uid).get()
      if (adminDoc.exists) {
        req.role = 'admin'
      }
    }
    
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Require admin role
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// Require principal role
export async function requirePrincipal(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.role !== 'principal' && req.role !== 'admin') {
    return res.status(403).json({ error: 'Principal access required' })
  }
  if (!req.schoolId && req.role !== 'admin') {
     return res.status(403).json({ error: 'No school associated with this account' })
  }
  next()
}

// Require teacher role
export async function requireTeacher(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.role !== 'teacher' && req.role !== 'principal' && req.role !== 'admin') {
    return res.status(403).json({ error: 'Teacher access required' })
  }
  if (!req.schoolId && req.role !== 'admin') {
    return res.status(403).json({ error: 'No school associated with this account' })
  }
  next()
}

export const adminOnly     = [verifyToken, requireAdmin]
export const principalOnly = [verifyToken, requirePrincipal]
export const staffOnly     = [verifyToken, requireTeacher]
