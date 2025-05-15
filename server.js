require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { logger, expressLogger, expressErrorLogger } = require('./utils/logger');
const authRoutes = require('./routes/auth');
const notificationsRoutes = require('./routes/notifications');
const downloadRoutes = require('./routes/download');
const errorHandler = require('./middlewares/error-handler');

// Asegurarse de que existan los directorios necesarios
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDirectoryExists('logs');
ensureDirectoryExists('screenshots');
ensureDirectoryExists('temp');

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Middleware
app.use(helmet());
app.use(cors({
  origin: CLIENT_URL,
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use(expressLogger);

// Rutas
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Rutas de la API
app.use('/login', authRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/download', downloadRoutes);

// Middleware para errores de formato JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    logger.error("Error de sintaxis JSON:", err);
    return res.status(400).json({ success: false, message: "JSON inválido" });
  }
  next(err);
});

// Logging de errores
app.use(expressErrorLogger);

// Middleware global para errores
app.use(errorHandler);

// Iniciar el servidor
app.listen(PORT, () => {
  logger.info(`Servidor escuchando en el puerto ${PORT}`);
});

// Manejar cierre ordenado
process.on('SIGTERM', () => {
  logger.info('Señal SIGTERM recibida. Cerrando servidor...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Error no capturado:', error);
  process.exit(1);
});

module.exports = app;