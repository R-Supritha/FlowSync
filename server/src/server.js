require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const protect = require('./middleware/authMiddleware');
const workspaceRoutes = require('./routes/workspaceRoutes');
const projectRoutes = require('./routes/projectRoutes');
const taskRoutes = require('./routes/taskRoutes');
const teamRoutes = require('./routes/teamRoutes');
const kanbanRoutes = require('./routes/kanbanRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const commentRoutes = require('./routes/commentRoutes');
const fileRoutes = require('./routes/fileRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const searchRoutes = require('./routes/searchRoutes');
const profileRoutes = require('./routes/profileRoutes');
const activityRoutes = require('./routes/activityRoutes');
const contributionRoutes = require('./routes/contributionRoutes');
const presenceRoutes = require('./routes/presenceRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const githubRoutes = require('./routes/githubRoutes');
const ocrRoutes = require('./routes/ocrRoutes');
const aiProjectRoutes = require('./routes/aiProjectRoutes');
const aiAssistRoutes = require('./routes/aiAssistRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const chatRoutes = require('./routes/chatRoutes');
const { mountAvatars } = require('./config/avatar');
const { UPLOAD_DIR } = require('./config/upload');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
mountAvatars(app); // profile pictures at /avatars (FR21)
app.use('/api', activityRoutes);
app.use('/api', contributionRoutes);
app.use('/api', presenceRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', chatRoutes);

// 100 requests per 15 minutes per computer by default. The app also checks notifications, presence and
// health in the background, so set RATE_LIMIT=1000 in server/.env while developing.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT) || 100,
});

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'FlowSync API is running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api', projectRoutes);
app.use('/api', taskRoutes);
app.use('/api', teamRoutes);
app.use('/api', kanbanRoutes);
app.use('/api', calendarRoutes);
app.use('/api', commentRoutes);
app.use('/api', fileRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', notificationRoutes);
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api', searchRoutes);
app.use('/api', profileRoutes);
app.use('/api', githubRoutes);
app.use('/api', ocrRoutes);
app.use('/api', aiProjectRoutes);
app.use('/api', aiAssistRoutes);
app.use('/api', settingsRoutes);

app.get('/api/test-protected', protect, (req, res) => {
  res.json({ success: true, message: 'You are authenticated', user: req.user });
});

// Anything that reached this point matched no route: answer in the same JSON shape as every other error.
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Last-resort error handler (bad JSON body, errors passed to next(), anything unexpected).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body is not valid JSON' });
  }
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`FlowSync API running on http://localhost:${PORT}`);
  });
}

startServer();