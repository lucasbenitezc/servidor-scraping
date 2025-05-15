const fs = require('fs');
const path = require('path');

/**
 * Asegura que un directorio exista, creándolo si es necesario
 * @param {string} dirPath - Ruta del directorio
 */
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Genera un nombre de archivo único para una captura de pantalla
 * @param {string} prefix - Prefijo para el nombre del archivo
 * @returns {string} - Ruta completa del archivo
 */
const generateScreenshotPath = (prefix) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join('screenshots', `${prefix}-${timestamp}.png`);
};

/**
 * Genera un nombre de archivo único para un documento descargado
 * @param {string} service - Nombre del servicio
 * @param {string} id - ID de la notificación
 * @returns {string} - Ruta completa del archivo
 */
const generateDocumentPath = (service, id) => {
  const timestamp = Date.now();
  return path.join('temp', `${service}-${id}-${timestamp}.pdf`);
};

/**
 * Limpia archivos temporales antiguos
 * @param {string} directory - Directorio a limpiar
 * @param {number} maxAgeMs - Edad máxima en milisegundos
 */
const cleanupOldFiles = (directory, maxAgeMs = 3600000) => { // 1 hora por defecto
  const now = Date.now();
  
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error(`Error al leer directorio ${directory}:`, err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(directory, file);
      
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error al obtener estadísticas del archivo ${file}:`, err);
          return;
        }
        
        if (now - stats.mtime.getTime() > maxAgeMs) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`Error al eliminar archivo ${file}:`, err);
            }
          });
        }
      });
    });
  });
};

module.exports = {
  ensureDirectoryExists,
  generateScreenshotPath,
  generateDocumentPath,
  cleanupOldFiles
};