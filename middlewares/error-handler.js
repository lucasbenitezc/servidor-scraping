const { logger } = require('../utils/logger');

/**
 * Middleware global para manejo de errores
 */
function errorHandler(err, req, res, next) {
  // Registrar el error
  logger.error('Error no capturado:', err);
  
  // Determinar el código de estado HTTP
  const statusCode = err.statusCode || 500;
  
  // Preparar el mensaje de error
  const errorResponse = {
    success: false,
    message: statusCode === 500 ? 'Error interno del servidor' : err.message
  };
  
  // En desarrollo, incluir la pila de llamadas
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }
  
  // Enviar respuesta
  res.status(statusCode).json(errorResponse);
}

module.exports = errorHandler;