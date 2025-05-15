const express = require('express');
const router = express.Router();
const fs = require('fs');
const { logger } = require('../utils/logger');
const { generateDocumentPath } = require('../utils/helpers');
const ScraperManager = require('../scrapers/scraper-manager');

// Inicializar el gestor de scrapers
const scraperManager = new ScraperManager();

/**
 * Ruta para descargar documentos
 * POST /download
 */
router.post('/', async (req, res, next) => {
  try {
    const { service, notificationId, browserSessionId } = req.body;
    
    if (!service || !notificationId || !browserSessionId) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros requeridos: service, notificationId, browserSessionId'
      });
    }
    
    logger.info(`Descargando documento de ${service} para notificación ${notificationId}`);
    
    const outputPath = generateDocumentPath(service, notificationId);
    
    const result = await scraperManager.downloadDocument(service, notificationId, browserSessionId, outputPath);
    
    if (result.success) {
      return res.download(outputPath, (err) => {
        if (err) {
          logger.error(`Error enviando archivo: ${err.message}`);
          return next(err);
        }
        
        // Eliminar el archivo después de enviarlo
        fs.unlink(outputPath, (unlinkErr) => {
          if (unlinkErr) {
            logger.error(`Error eliminando archivo temporal: ${unlinkErr.message}`);
          }
        });
      });
    } else {
      return res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error en endpoint /download:', error);
    next(error);
  }
});

module.exports = router;