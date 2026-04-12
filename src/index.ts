import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
dotenv.config()

import schoolsRouter from './routes/schools'
import authRouter    from './routes/auth'
import {
  paymentsRouter, registrationsRouter, messagesRouter, analyticsRouter
} from './routes/api'

import studentsRouter from './routes/students'
import staffRouter    from './routes/staff'
import classesRouter  from './routes/classes'
import attendanceRouter from './routes/attendance'
import teachersRouter from './routes/teachers'
import feesRouter from './routes/fees'
import dashboardRouter from './routes/dashboard'
import plansRouter from './routes/plans'
import personnelPaymentsRouter from './routes/personnelPayments'
import { startAttendanceCron } from './cron/attendanceCron'

const app  = express()
const PORT = process.env.PORT || 4000
const IS_PROD = process.env.NODE_ENV === 'production'

// Disable Express fingerprinting
app.disable('x-powered-by')

// ── Security & middleware ─────────────────────────────────────────────────────
app.use(helmet())
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .concat(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'])

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { error: 'Too many requests' } })
const strictLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Slow down' } })
app.use('/api', limiter)
app.use('/api/auth', strictLimiter)

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter)
app.use('/api/schools',       schoolsRouter)
app.use('/api/payments',      paymentsRouter)
app.use('/api/registrations', registrationsRouter)
app.use('/api/requests',      registrationsRouter)
app.use('/api/messages',      messagesRouter)
app.use('/api/analytics',     analyticsRouter)
app.use('/api/dashboard',     dashboardRouter)
app.use('/api/admin/plans',   plansRouter)

// School-specific routes
app.use('/api/students',      studentsRouter)
app.use('/api/staff',         staffRouter)
app.use('/api/teachers',      teachersRouter)
app.use('/api/classes',       classesRouter)
app.use('/api/attendance',    attendanceRouter)
app.use('/api/fees',          feesRouter)
app.use('/api/personnel-payments', personnelPaymentsRouter)

// Health check
app.get('/health', (_req, res) => res.json({
  status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0'
}))

// 404
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }))

// Global error handler — never leak stack traces to clients
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || err.statusCode || 500
  // Log internally but send a sanitised message in production
  console.error(`[${new Date().toISOString()}] Error ${status}:`, err.message)
  if (IS_PROD) {
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' })
  } else {
    res.status(status).json({ error: err.message, stack: err.stack })
  }
})

app.listen(PORT, () => {
  console.log(`\n🚀 EduSync API running on http://localhost:${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health\n`)
  
  // Boot scheduled background jobs
  startAttendanceCron()
})

export default app
