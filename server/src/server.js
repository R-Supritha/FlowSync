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
const { UPLOAD_DIR } = require('./config/upload');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
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

app.get('/api/test-protected', protect, (req, res) => {
  res.json({ success: true, message: 'You are authenticated', user: req.user });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`FlowSync API running on http://localhost:${PORT}`);
  });
}

startServer();