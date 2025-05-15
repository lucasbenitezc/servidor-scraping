const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const ScraperManager = require('../scrapers/scraper-manager');

// Inicializar el gestor de scrapers
const scraperManager = new ScraperManager();

/**
 * Ruta para autenticación en servicios
 * POST /login
 */
router.post('/', async (req, res, next) => {
  try {
    const { service, username, password } = req.body;
    
    if (!service || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros requeridos: service, username, password'
      });
    }
    
    logger.info(`Intento de login en ${service} para ${username}`);
    
    const result = await scraperManager.login(service, username, password);
    
    return res.json(result);
  } catch (error) {
    logger.error('Error en endpoint /login:', error);
    next(error);
  }
});

module.exports = router;