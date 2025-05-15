const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const ScraperManager = require('../scrapers/scraper-manager');

// Inicializar el gestor de scrapers
const scraperManager = new ScraperManager();

/**
 * Ruta para obtener notificaciones
 * POST /notifications
 */
router.post('/', async (req, res, next) => {
  try {
    const { service, browserSessionId } = req.body;
    
    if (!service || !browserSessionId) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros requeridos: service, browserSessionId'
      });
    }
    
    logger.info(`Obteniendo notificaciones de ${service}`);
    
    const result = await scraperManager.getNotifications(service, browserSessionId);
    
    return res.json(result);
  } catch (error) {
    logger.error('Error en endpoint /notifications:', error);
    next(error);
  }
});

module.exports = router;