import { Router, Response } from 'express';
import { principalOnly, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { sendBulkEmail } from '../lib/emailService';

const router = Router();

const BulkEmailSchema = z.object({
  recipients: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional()
  })).min(1),
  subject: z.string().min(1),
  message: z.string().min(1),
  senderName: z.string().optional(),
});

router.post('/bulk', ...principalOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = BulkEmailSchema.parse(req.body);
    
    // Resolve the display name natively if not specifically overridden
    const senderName = data.senderName || req.email?.split('@')[0] || 'Principal';
    
    const results = await sendBulkEmail({
      recipients: data.recipients,
      subject: data.subject,
      messageTemplate: data.message,
      senderName,
      senderEmail: req.email || '', // Injected cleanly referencing the authorized token payload (Principal's email)
    });

    res.status(200).json({ success: true, results });
  } catch (e: any) {
    if (e.name === 'ZodError') {
      return res.status(400).json({ error: e.errors });
    }
    console.error('❌ [Email Route Error]', e);
    res.status(500).json({ error: 'Failed to process bulk email request.' });
  }
});

export default router;
