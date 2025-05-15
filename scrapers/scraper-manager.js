const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { ensureDirectoryExists, generateScreenshotPath } = require('../utils/helpers');

// Asegurarse de que existan los directorios necesarios
ensureDirectoryExists('logs');
ensureDirectoryExists('screenshots');
ensureDirectoryExists('temp');

// Usar plugin stealth
puppeteer.use(StealthPlugin());

class ScraperManager {
  constructor() {
    this.browserSessions = new Map();
    this.sessionTimeouts = new Map();
    this.sessionData = new Map(); // Para almacenar datos de sesión (cookies, etc.)
    this.maxConcurrentBrowsers = 5; // Limitar el número de navegadores simultáneos
  }

  async _getBrowser(sessionId) {
    if (this.browserSessions.has(sessionId)) {
      // Renovar timeout de sesión
      if (this.sessionTimeouts.has(sessionId)) {
        clearTimeout(this.sessionTimeouts.get(sessionId));
      }
      
      this.sessionTimeouts.set(
        sessionId,
        setTimeout(() => this._closeBrowserSession(sessionId), 30 * 60 * 1000) // 30 minutos
      );
      
      return this.browserSessions.get(sessionId);
    }

    // Verificar si ya hay demasiados navegadores abiertos
    if (this.browserSessions.size >= this.maxConcurrentBrowsers) {
      throw new Error('Demasiados navegadores abiertos. Intenta más tarde.');
    }

    // Configuración para entornos sin interfaz gráfica
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1280,800'
      ],
      defaultViewport: {
        width: 1280,
        height: 800
      }
    });

    this.browserSessions.set(sessionId, browser);
    
    // Configurar timeout para cerrar la sesión después de inactividad
    this.sessionTimeouts.set(
      sessionId,
      setTimeout(() => this._closeBrowserSession(sessionId), 30 * 60 * 1000) // 30 minutos
    );
    
    return browser;
  }

  async _closeBrowserSession(sessionId) {
    if (this.browserSessions.has(sessionId)) {
      const browser = this.browserSessions.get(sessionId);
      await browser.close().catch(err => {
        logger.error(`Error al cerrar navegador para sesión ${sessionId}:`, err);
      });
      this.browserSessions.delete(sessionId);
      logger.info(`Sesión de navegador ${sessionId} cerrada por inactividad`);
    }
    
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId));
      this.sessionTimeouts.delete(sessionId);
    }
    
    if (this.sessionData.has(sessionId)) {
      this.sessionData.delete(sessionId);
    }
  }

  async _setupPage(page) {
    // Configurar timeouts
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(30000);
    
    // Optimizaciones para mejorar el rendimiento
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Bloquear recursos que no son necesarios para el scraping
      const resourceType = request.resourceType();
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Configurar user agent para parecer un navegador normal
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    return page;
  }

  async _takeScreenshot(page, name) {
    try {
      const screenshotPath = generateScreenshotPath(name);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(`Screenshot guardado en ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      logger.error(`Error al tomar screenshot: ${error.message}`);
      return null;
    }
  }

  // ===== IMPLEMENTACIÓN DE LOGIN PARA CADA SERVICIO =====

  async _loginPJN(page, username, password) {
    try {
      logger.info('Iniciando login en PJN');
      
      // Navegar a la página de login del PJN
      await page.goto('https://eje.pjn.gov.ar/eje/login.seam', {
        waitUntil: 'networkidle2'
      });
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'pjn-login-page');
      
      // Esperar a que aparezca el formulario de login
      await page.waitForSelector('#loginForm');
      
      // Ingresar credenciales
      await page.type('#username', username);
      await page.type('#password', password);
      
      // Hacer clic en el botón de login
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#loginButton')
      ]);
      
      // Verificar si el login fue exitoso
      const loginError = await page.evaluate(() => {
        const errorElement = document.querySelector('.error-message, .alert-danger');
        return errorElement ? errorElement.innerText : null;
      });
      
      if (loginError) {
        logger.error(`Error de login en PJN: ${loginError}`);
        return false;
      }
      
      // Verificar si estamos en la página principal después del login
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('.user-info, .user-panel, .logout-button') !== null;
      });
      
      if (!isLoggedIn) {
        logger.error('No se pudo verificar el login exitoso en PJN');
        await this._takeScreenshot(page, 'pjn-login-failed');
        return false;
      }
      
      logger.info('Login exitoso en PJN');
      await this._takeScreenshot(page, 'pjn-login-success');
      return true;
    } catch (error) {
      logger.error(`Error en login PJN: ${error.message}`);
      await this._takeScreenshot(page, 'pjn-login-error');
      return false;
    }
  }

  async _loginAFIP(page, username, password) {
    try {
      logger.info('Iniciando login en AFIP');
      
      // Navegar a la página de login de AFIP
      await page.goto('https://auth.afip.gob.ar/contribuyente_/login.xhtml', {
        waitUntil: 'networkidle2'
      });
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'afip-login-page');
      
      // Ingresar CUIT/CUIL
      await page.waitForSelector('#F1\\:username');
      await page.type('#F1\\:username', username);
      
      // Hacer clic en el botón "Siguiente"
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#F1\\:btnSiguiente')
      ]);
      
      // Ingresar contraseña
      await page.waitForSelector('#F1\\:password');
      await page.type('#F1\\:password', password);
      
      // Hacer clic en el botón "Ingresar"
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#F1\\:btnIngresar')
      ]);
      
      // Verificar si el login fue exitoso
      const loginError = await page.evaluate(() => {
        const errorElement = document.querySelector('.mensajeError');
        return errorElement ? errorElement.innerText : null;
      });
      
      if (loginError) {
        logger.error(`Error de login en AFIP: ${loginError}`);
        return false;
      }
      
      // Verificar si estamos en la página principal después del login
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('.usuario_info, .logout, .salir') !== null;
      });
      
      if (!isLoggedIn) {
        logger.error('No se pudo verificar el login exitoso en AFIP');
        await this._takeScreenshot(page, 'afip-login-failed');
        return false;
      }
      
      logger.info('Login exitoso en AFIP');
      await this._takeScreenshot(page, 'afip-login-success');
      return true;
    } catch (error) {
      logger.error(`Error en login AFIP: ${error.message}`);
      await this._takeScreenshot(page, 'afip-login-error');
      return false;
    }
  }

  async _loginTAD(page, username, password) {
    try {
      logger.info('Iniciando login en TAD (a través de AFIP)');
      
      // Primero hacer login en AFIP
      const afipLoginSuccess = await this._loginAFIP(page, username, password);
      
      if (!afipLoginSuccess) {
        logger.error('No se pudo iniciar sesión en AFIP para acceder a TAD');
        return false;
      }
      
      // Navegar a TAD desde AFIP
      logger.info('Navegando a TAD desde AFIP');
      
      // Buscar y hacer clic en el servicio TAD
      await page.waitForSelector('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")');
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        page.click('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")')
      ]);
      
      // Esperar a que se cargue la página de TAD
      await page.waitForSelector('.tad-header, .header-tad, .tad-logo', { timeout: 60000 });
      
      // Verificar si estamos en TAD
      const isTADLoaded = await page.evaluate(() => {
        return document.querySelector('.tad-header, .header-tad, .tad-logo') !== null;
      });
      
      if (!isTADLoaded) {
        logger.error('No se pudo acceder a TAD desde AFIP');
        await this._takeScreenshot(page, 'tad-navigation-failed');
        return false;
      }
      
      logger.info('Acceso exitoso a TAD');
      await this._takeScreenshot(page, 'tad-login-success');
      return true;
    } catch (error) {
      logger.error(`Error en login TAD: ${error.message}`);
      await this._takeScreenshot(page, 'tad-login-error');
      return false;
    }
  }

  // ===== MÉTODO PRINCIPAL DE LOGIN =====

  async login(service, username, password) {
    let sessionId = uuidv4();
    let browser = null;
    let page = null;
    
    try {
      logger.info(`Iniciando login en ${service} para ${username}`);
      
      browser = await this._getBrowser(sessionId);
      page = await browser.newPage();
      await this._setupPage(page);
      
      let loginSuccess = false;
      
      // Implementar lógica de login específica para cada servicio
      switch (service.toLowerCase()) {
        case 'pjn':
          loginSuccess = await this._loginPJN(page, username, password);
          break;
        case 'afip':
          loginSuccess = await this._loginAFIP(page, username, password);
          break;
        case 'tad':
          loginSuccess = await this._loginTAD(page, username, password);
          break;
        default:
          throw new Error(`Servicio no soportado: ${service}`);
      }
      
      if (!loginSuccess) {
        // Cerrar navegador y limpiar si falló
        await this._closeBrowserSession(sessionId);
        
        return {
          success: false,
          message: "Credenciales incorrectas o problema de conexión",
        };
      }
      
      // Guardar datos de sesión
      this.sessionData.set(sessionId, {
        service,
        username,
        lastActivity: Date.now()
      });
      
      // Cerrar la página pero mantener el navegador abierto
      await page.close();
      
      return {
        success: true,
        browserSessionId: sessionId,
      };
    } catch (error) {
      logger.error(`Error en login ${service}:`, error);
      
      // Limpiar recursos en caso de error
      if (sessionId && this.browserSessions.has(sessionId)) {
        await this._closeBrowserSession(sessionId);
      }
      
      return {
        success: false,
        message: `Error de autenticación: ${error.message}`,
      };
    }
  }

  // ===== IMPLEMENTACIÓN DE OBTENCIÓN DE NOTIFICACIONES PARA CADA SERVICIO =====

  async _getPJNNotifications(page) {
    try {
      logger.info('Obteniendo notificaciones de PJN');
      
      // Navegar a la sección de notificaciones
      await page.goto('https://eje.pjn.gov.ar/eje/pages/notificaciones/listadoNotificaciones.seam', {
        waitUntil: 'networkidle2'
      });
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, #notificacionesTable');
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'pjn-notifications');
      
      // Extraer las notificaciones
      const notifications = await page.evaluate(() => {
        const tabla = document.querySelector('table.notificaciones, #notificacionesTable');
        if (!tabla) return [];
        
        const filas = Array.from(tabla.querySelectorAll('tbody tr'));
        
        return filas.map(fila => {
          const celdas = fila.querySelectorAll('td');
          
          // Ajustar estos índices según la estructura real de la tabla
          const id = celdas[0]?.innerText.trim() || '';
          const fecha = celdas[1]?.innerText.trim() || '';
          const expediente = celdas[2]?.innerText.trim() || '';
          const asunto = celdas[3]?.innerText.trim() || '';
          const estado = celdas[4]?.innerText.trim() || '';
          
          // Determinar si está leído basado en clases CSS o texto
          const leido = fila.classList.contains('leido') || 
                       estado.toLowerCase().includes('leído') || 
                       estado.toLowerCase().includes('leida');
          
          // Verificar si hay un enlace para descargar o ver el documento
          const tieneAdjunto = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar') !== null;
          
          return {
            id,
            fecha,
            expediente,
            asunto,
            estado,
            leido,
            tieneAdjunto,
            servicio: 'pjn'
          };
        });
      });
      
      logger.info(`Se encontraron ${notifications.length} notificaciones de PJN`);
      
      return {
        success: true,
        notifications,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error obteniendo notificaciones de PJN: ${error.message}`);
      await this._takeScreenshot(page, 'pjn-notifications-error');
      throw error;
    }
  }

  async _getAFIPNotifications(page) {
    try {
      logger.info('Obteniendo notificaciones de AFIP');
      
      // Navegar a la página principal de AFIP
      await page.goto('https://auth.afip.gob.ar/contribuyente_/inicio.xhtml', {
        waitUntil: 'networkidle2'
      });
      
      // Esperar a que cargue la página de servicios
      await page.waitForSelector('a[title="SICNEA - ABOGADOS"], a:contains("SICNEA - ABOGADOS")');
      
      // Hacer clic en el enlace "SICNEA - ABOGADOS"
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('a[title="SICNEA - ABOGADOS"], a:contains("SICNEA - ABOGADOS")')
      ]);
      
      // NUEVO: Esperar a que aparezca el pop-up
      logger.info('Esperando a que aparezca el pop-up de SICNEA');
      await page.waitForSelector('.modal-dialog, .popup-container, #modalSicnea, div[role="dialog"]', {
        timeout: 30000
      });
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'afip-sicnea-popup');
      
      // NUEVO: Hacer clic en "Ver notificación" en el pop-up
      logger.info('Haciendo clic en "Ver notificación" en el pop-up');
      
      // Intentar diferentes selectores que podrían contener el botón "Ver notificación"
      const verNotificacionButton = await page.evaluate(() => {
        // Buscar por texto exacto
        const porTextoExacto = Array.from(document.querySelectorAll('button, a')).find(
          el => el.innerText.trim() === 'Ver notificación'
        );
        if (porTextoExacto) return porTextoExacto.outerHTML;
        
        // Buscar por texto que contenga "Ver notificación"
        const porTextoContiene = Array.from(document.querySelectorAll('button, a')).find(
          el => el.innerText.trim().includes('Ver notificación')
        );
        if (porTextoContiene) return porTextoContiene.outerHTML;
        
        // Buscar por clases comunes para botones de acción
        const porClase = document.querySelector('.btn-primary, .btn-action, .action-button, .ver-notificacion');
        if (porClase) return porClase.outerHTML;
        
        return null;
      });
      
      if (!verNotificacionButton) {
        logger.error('No se pudo encontrar el botón "Ver notificación" en el pop-up');
        await this._takeScreenshot(page, 'afip-popup-error');
        throw new Error('No se pudo encontrar el botón "Ver notificación"');
      }
      
      logger.info(`Botón encontrado: ${verNotificacionButton}`);
      
      // Hacer clic en el botón "Ver notificación"
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button:contains("Ver notificación"), a:contains("Ver notificación"), .btn-primary, .btn-action, .action-button, .ver-notificacion')
      ]);
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, table.comunicaciones, div.notificaciones-container table');
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'afip-notifications');
      
      // Extraer las notificaciones
      const notifications = await page.evaluate(() => {
        const tabla = document.querySelector('table.notificaciones, table.comunicaciones, div.notificaciones-container table');
        if (!tabla) return [];
        
        const filas = Array.from(tabla.querySelectorAll('tr:not(:first-child)'));
        
        return filas.map(fila => {
          const celdas = fila.querySelectorAll('td');
          
          // Ajustar estos índices según la estructura real de la tabla
          const id = celdas[0]?.innerText.trim() || '';
          const fecha = celdas[1]?.innerText.trim() || '';
          const asunto = celdas[2]?.innerText.trim() || '';
          const descripcion = celdas[3]?.innerText.trim() || asunto;
          const estado = celdas[4]?.innerText.trim() || '';
          
          // Verificar si hay un enlace para descargar o ver el documento
          const tieneAdjunto = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar') !== null;
          
          // Determinar si está leído basado en clases CSS o texto
          const leido = fila.classList.contains('leido') || 
                       fila.classList.contains('read') || 
                       estado.toLowerCase().includes('leído') || 
                       estado.toLowerCase().includes('leida');
          
          return {
            id,
            fecha,
            asunto,
            descripcion,
            estado,
            tieneAdjunto,
            servicio: 'afip',
            leido
          };
        });
      });
      
      // Manejar paginación si existe
      const hasPagination = await page.evaluate(() => {
        return document.querySelector('.pagination, .paginador, nav.pagination-container') !== null;
      });
      
      if (hasPagination) {
        logger.info('Se detectó paginación, procesando páginas adicionales');
        
        // Determinar el número total de páginas
        const totalPages = await page.evaluate(() => {
          const paginationElement = document.querySelector('.pagination, .paginador, nav.pagination-container');
          if (!paginationElement) return 1;
          
          // Buscar el número de la última página
          const lastPageLink = paginationElement.querySelector('li:last-child a, a:last-child');
          if (lastPageLink) {
            const pageNum = parseInt(lastPageLink.innerText.trim(), 10);
            return isNaN(pageNum) ? 1 : pageNum;
          }
          
          // Alternativa: buscar texto que indique el total de páginas
          const paginationText = paginationElement.innerText;
          const match = paginationText.match(/de (\d+) páginas/);
          return match ? parseInt(match[1], 10) : 1;
        });
        
        // Procesar cada página
        for (let currentPage = 2; currentPage <= totalPages; currentPage++) {
          logger.info(`Procesando página ${currentPage} de ${totalPages}`);
          
          // Hacer clic en el botón "Siguiente" o en el número de página
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(`.pagination a[data-page="${currentPage}"], .paginador a[data-page="${currentPage}"], .pagination-next, a.next-page`)
          ]);
          
          // Esperar a que se cargue la tabla
          await page.waitForSelector('table.notificaciones, table.comunicaciones, div.notificaciones-container table');
          
          // Extraer notificaciones de esta página
          const pageNotifications = await page.evaluate(() => {
            const tabla = document.querySelector('table.notificaciones, table.comunicaciones, div.notificaciones-container table');
            if (!tabla) return [];
            
            const filas = Array.from(tabla.querySelectorAll('tr:not(:first-child)'));
            
            return filas.map(fila => {
              const celdas = fila.querySelectorAll('td');
              
              const id = celdas[0]?.innerText.trim() || '';
              const fecha = celdas[1]?.innerText.trim() || '';
              const asunto = celdas[2]?.innerText.trim() || '';
              const descripcion = celdas[3]?.innerText.trim() || asunto;
              const estado = celdas[4]?.innerText.trim() || '';
              
              const tieneAdjunto = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar') !== null;
              
              const leido = fila.classList.contains('leido') || 
                           fila.classList.contains('read') || 
                           estado.toLowerCase().includes('leído') || 
                           estado.toLowerCase().includes('leida');
              
              return {
                id,
                fecha,
                asunto,
                descripcion,
                estado,
                tieneAdjunto,
                servicio: 'afip',
                leido
              };
            });
          });
          
          // Añadir las notificaciones de esta página al array principal
          notifications.push(...pageNotifications);
          
          // Esperar un poco entre páginas para no sobrecargar el servidor
          await page.waitForTimeout(1000);
        }
      }
      
      logger.info(`Se encontraron ${notifications.length} notificaciones de AFIP`);
      
      return {
        success: true,
        notifications,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error obteniendo notificaciones de AFIP: ${error.message}`);
      await this._takeScreenshot(page, 'afip-notifications-error');
      throw error;
    }
  }

  async _getTADNotifications(page) {
    try {
      logger.info('Obteniendo notificaciones de TAD');
      
      // Primero verificar si ya estamos en TAD, si no, hacer login
      const isTADLoaded = await page.evaluate(() => {
        return document.querySelector('.tad-header, .header-tad, .tad-logo') !== null;
      });
      
      if (!isTADLoaded) {
        logger.info('No estamos en TAD, navegando a TAD desde AFIP');
        
        // Navegar a la página principal de AFIP
        await page.goto('https://auth.afip.gob.ar/contribuyente_/inicio.xhtml', {
          waitUntil: 'networkidle2'
        });
        
        // Esperar a que cargue la página de servicios
        await page.waitForSelector('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")');
        
        // Hacer clic en el enlace "Trámites a Distancia"
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
          page.click('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")')
        ]);
        
        // Esperar a que se cargue la página de TAD
        await page.waitForSelector('.tad-header, .header-tad, .tad-logo', { timeout: 60000 });
      }
      
      // Navegar a la sección de notificaciones en TAD
      logger.info('Navegando a la sección de notificaciones en TAD');
      
      // Buscar y hacer clic en la pestaña de notificaciones
      await page.waitForSelector('a[href*="notificaciones"], a:contains("Notificaciones"), button:contains("Notificaciones")');
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('a[href*="notificaciones"], a:contains("Notificaciones"), button:contains("Notificaciones")')
      ]);
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, .notificaciones-table, .listado-notificaciones');
      
      // Tomar screenshot para debugging
      await this._takeScreenshot(page, 'tad-notifications');
      
      // Extraer las notificaciones
      const notifications = await page.evaluate(() => {
        const tabla = document.querySelector('table.notificaciones, .notificaciones-table, .listado-notificaciones');
        if (!tabla) return [];
        
        const filas = Array.from(tabla.querySelectorAll('tr:not(:first-child), .notificacion-item, .fila-notificacion'));
        
        return filas.map(fila => {
          // Intentar diferentes selectores para adaptarse a la estructura de la página
          const id = fila.querySelector('.id-notificacion, [data-id]')?.innerText.trim() || 
                    fila.getAttribute('data-id') || '';
          
          const fecha = fila.querySelector('.fecha, .fecha-notificacion')?.innerText.trim() || '';
          
          const asunto = fila.querySelector('.asunto, .titulo-notificacion, .titulo')?.innerText.trim() || '';
          
          const descripcion = fila.querySelector('.descripcion, .detalle-notificacion, .detalle')?.innerText.trim() || asunto;
          
          const estado = fila.querySelector('.estado, .estado-notificacion')?.innerText.trim() || '';
          
          // Verificar si hay un enlace para descargar o ver el documento
          const tieneAdjunto = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar, .icono-adjunto') !== null;
          
          // Determinar si está leído basado en clases CSS o texto
          const leido = fila.classList.contains('leido') || 
                       fila.classList.contains('read') || 
                       estado.toLowerCase().includes('leído') || 
                       estado.toLowerCase().includes('leida');
          
          return {
            id,
            fecha,
            asunto,
            descripcion,
            estado,
            tieneAdjunto,
            servicio: 'tad',
            leido
          };
        });
      });
      
      // Manejar paginación si existe
      const hasPagination = await page.evaluate(() => {
        return document.querySelector('.pagination, .paginador, .paginacion') !== null;
      });
      
      if (hasPagination) {
        logger.info('Se detectó paginación, procesando páginas adicionales');
        
        // Determinar el número total de páginas
        const totalPages = await page.evaluate(() => {
          const paginationElement = document.querySelector('.pagination, .paginador, .paginacion');
          if (!paginationElement) return 1;
          
          // Buscar el número de la última página
          const lastPageLink = paginationElement.querySelector('li:last-child a, a:last-child');
          if (lastPageLink) {
            const pageNum = parseInt(lastPageLink.innerText.trim(), 10);
            return isNaN(pageNum) ? 1 : pageNum;
          }
          
          // Alternativa: buscar texto que indique el total de páginas
          const paginationText = paginationElement.innerText;
          const match = paginationText.match(/de (\d+) páginas/);
          return match ? parseInt(match[1], 10) : 1;
        });
        
        // Procesar cada página
        for (let currentPage = 2; currentPage <= totalPages; currentPage++) {
          logger.info(`Procesando página ${currentPage} de ${totalPages}`);
          
          // Hacer clic en el botón "Siguiente" o en el número de página
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(`.pagination a[data-page="${currentPage}"], .paginador a[data-page="${currentPage}"], .pagination-next, a.next-page, a[aria-label="Next page"]`)
          ]);
          
          // Esperar a que se cargue la tabla
          await page.waitForSelector('table.notificaciones, .notificaciones-table, .listado-notificaciones');
          
          // Extraer notificaciones de esta página
          const pageNotifications = await page.evaluate(() => {
            const tabla = document.querySelector('table.notificaciones, .notificaciones-table, .listado-notificaciones');
            if (!tabla) return [];
            
            const filas = Array.from(tabla.querySelectorAll('tr:not(:first-child), .notificacion-item, .fila-notificacion'));
            
            return filas.map(fila => {
              const id = fila.querySelector('.id-notificacion, [data-id]')?.innerText.trim() || 
                        fila.getAttribute('data-id') || '';
              
              const fecha = fila.querySelector('.fecha, .fecha-notificacion')?.innerText.trim() || '';
              
              const asunto = fila.querySelector('.asunto, .titulo-notificacion, .titulo')?.innerText.trim() || '';
              
              const descripcion = fila.querySelector('.descripcion, .detalle-notificacion, .detalle')?.innerText.trim() || asunto;
              
              const estado = fila.querySelector('.estado, .estado-notificacion')?.innerText.trim() || '';
              
              const tieneAdjunto = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar, .icono-adjunto') !== null;
              
              const leido = fila.classList.contains('leido') || 
                           fila.classList.contains('read') || 
                           estado.toLowerCase().includes('leído') || 
                           estado.toLowerCase().includes('leida');
              
              return {
                id,
                fecha,
                asunto,
                descripcion,
                estado,
                tieneAdjunto,
                servicio: 'tad',
                leido
              };
            });
          });
          
          // Añadir las notificaciones de esta página al array principal
          notifications.push(...pageNotifications);
          
          // Esperar un poco entre páginas para no sobrecargar el servidor
          await page.waitForTimeout(1000);
        }
      }
      
      logger.info(`Se encontraron ${notifications.length} notificaciones de TAD`);
      
      return {
        success: true,
        notifications,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error obteniendo notificaciones de TAD: ${error.message}`);
      await this._takeScreenshot(page, 'tad-notifications-error');
      throw error;
    }
  }

  // ===== MÉTODO PRINCIPAL PARA OBTENER NOTIFICACIONES =====

  async getNotifications(service, sessionId) {
    let page = null;
    
    try {
      logger.info(`Obteniendo notificaciones de ${service} para sesión ${sessionId}`);
      
      // Verificar si la sesión existe
      if (!this.browserSessions.has(sessionId)) {
        return {
          success: false,
          message: "Sesión no encontrada o expirada"
        };
      }
      
      // Actualizar timestamp de actividad
      if (this.sessionData.has(sessionId)) {
        const sessionInfo = this.sessionData.get(sessionId);
        sessionInfo.lastActivity = Date.now();
        this.sessionData.set(sessionId, sessionInfo);
      }
      
      // Obtener el navegador de la sesión
      const browser = await this._getBrowser(sessionId);
      
      // Crear una nueva página
      page = await browser.newPage();
      await this._setupPage(page);
      
      // Obtener notificaciones según el servicio
      let result;
      
      switch (service.toLowerCase()) {
        case 'pjn':
          result = await this._getPJNNotifications(page);
          break;
        case 'afip':
          result = await this._getAFIPNotifications(page);
          break;
        case 'tad':
          result = await this._getTADNotifications(page);
          break;
        default:
          throw new Error(`Servicio no soportado: ${service}`);
      }
      
      // Cerrar la página para liberar recursos
      await page.close();
      
      return result;
    } catch (error) {
      logger.error(`Error al obtener notificaciones de ${service}:`, error);
      
      // Intentar tomar screenshot en caso de error
      if (page) {
        await this._takeScreenshot(page, `${service}-error-${Date.now()}`);
        await page.close();
      }
      
      return {
        success: false,
        message: `Error al obtener notificaciones: ${error.message}`
      };
    }
  }

  // ===== IMPLEMENTACIÓN DE DESCARGA DE DOCUMENTOS PARA CADA SERVICIO =====

  async _downloadPJNDocument(page, notificationId, outputPath) {
    try {
      logger.info(`Descargando documento de PJN para notificación ${notificationId}`);
      
      // Navegar a la sección de notificaciones
      await page.goto('https://eje.pjn.gov.ar/eje/pages/notificaciones/listadoNotificaciones.seam', {
        waitUntil: 'networkidle2'
      });
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, #notificacionesTable');
      
      // Buscar la notificación específica por ID
      const notificationFound = await page.evaluate((id) => {
        const filas = Array.from(document.querySelectorAll('table.notificaciones tbody tr, #notificacionesTable tbody tr'));
        
        for (const fila of filas) {
          const celdas = fila.querySelectorAll('td');
          const notificationId = celdas[0]?.innerText.trim();
          
          if (notificationId === id) {
            // Encontrar el botón o enlace de descarga
            const downloadButton = fila.querySelector('a[href*="descargar"], button.descargar');
            
            if (downloadButton) {
              // Simular clic en el botón de descarga
              downloadButton.click();
              return true;
            }
          }
        }
        
        return false;
      }, notificationId);
      
      if (!notificationFound) {
        throw new Error(`Notificación ${notificationId} no encontrada`);
      }
      
      // Esperar a que se complete la descarga
      await page.waitForSelector('.download-complete, .descarga-completa', { timeout: 30000 });
      
      // Obtener la URL del documento
      const documentUrl = await page.evaluate(() => {
        const downloadLink = document.querySelector('a.download-link, a.enlace-descarga');
        return downloadLink ? downloadLink.href : null;
      });
      
      if (!documentUrl) {
        throw new Error('No se pudo obtener la URL del documento');
      }
      
      // Descargar el documento
      const documentResponse = await page.goto(documentUrl, { waitUntil: 'networkidle2' });
      const documentBuffer = await documentResponse.buffer();
      
      // Guardar el documento en el sistema de archivos
      fs.writeFileSync(outputPath, documentBuffer);
      
      logger.info(`Documento de PJN guardado en ${outputPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Error descargando documento de PJN: ${error.message}`);
      await this._takeScreenshot(page, 'pjn-download-error');
      throw error;
    }
  }

  async _downloadAFIPDocument(page, notificationId, outputPath) {
    try {
      logger.info(`Descargando documento de AFIP para notificación ${notificationId}`);
      
      // Navegar a la página principal de AFIP
      await page.goto('https://auth.afip.gob.ar/contribuyente_/inicio.xhtml', {
        waitUntil: 'networkidle2'
      });
      
      // Esperar a que cargue la página de servicios
      await page.waitForSelector('a[title="SICNEA - ABOGADOS"], a:contains("SICNEA - ABOGADOS")');
      
      // Hacer clic en el enlace "SICNEA - ABOGADOS"
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('a[title="SICNEA - ABOGADOS"], a:contains("SICNEA - ABOGADOS")')
      ]);
      
      // Esperar a que aparezca el pop-up
      logger.info('Esperando a que aparezca el pop-up de SICNEA');
      await page.waitForSelector('.modal-dialog, .popup-container, #modalSicnea, div[role="dialog"]', {
        timeout: 30000
      });
      
      // Hacer clic en "Ver notificación" en el pop-up
      logger.info('Haciendo clic en "Ver notificación" en el pop-up');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button:contains("Ver notificación"), a:contains("Ver notificación"), .btn-primary, .btn-action, .action-button, .ver-notificacion')
      ]);
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, table.comunicaciones, div.notificaciones-container table');
      
      // Configurar la descarga de archivos
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: path.dirname(outputPath)
      });
      
      // Buscar la notificación específica por ID y descargar
      const notificationFound = await page.evaluate((id) => {
        const filas = Array.from(document.querySelectorAll('table.notificaciones tr, table.comunicaciones tr, div.notificaciones-container table tr'));
        
        for (const fila of filas) {
          const celdas = fila.querySelectorAll('td');
          const notificationId = celdas[0]?.innerText.trim();
          
          if (notificationId === id) {
            // Encontrar el botón o enlace de descarga
            const downloadButton = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar');
            
            if (downloadButton) {
              // Simular clic en el botón de descarga
              downloadButton.click();
              return true;
            }
          }
        }
        
        return false;
      }, notificationId);
      
      if (!notificationFound) {
        throw new Error(`Notificación ${notificationId} no encontrada`);
      }
      
      // Esperar a que se complete la descarga (esto puede variar según cómo funcione la descarga en AFIP)
      await page.waitForTimeout(5000);
      
      // Verificar si el archivo se descargó correctamente
      const downloadedFiles = fs.readdirSync(path.dirname(outputPath));
      const downloadedFile = downloadedFiles.find(file => file.includes('.pdf') || file.includes('.doc') || file.includes('.docx'));
      
      if (!downloadedFile) {
        throw new Error('No se pudo descargar el documento');
      }
      
      // Mover el archivo descargado a la ubicación deseada
      const downloadedFilePath = path.join(path.dirname(outputPath), downloadedFile);
      fs.renameSync(downloadedFilePath, outputPath);
      
      logger.info(`Documento de AFIP guardado en ${outputPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Error descargando documento de AFIP: ${error.message}`);
      await this._takeScreenshot(page, 'afip-download-error');
      throw error;
    }
  }

  async _downloadTADDocument(page, notificationId, outputPath) {
    try {
      logger.info(`Descargando documento de TAD para notificación ${notificationId}`);
      
      // Primero verificar si ya estamos en TAD, si no, hacer login
      const isTADLoaded = await page.evaluate(() => {
        return document.querySelector('.tad-header, .header-tad, .tad-logo') !== null;
      });
      
      if (!isTADLoaded) {
        logger.info('No estamos en TAD, navegando a TAD desde AFIP');
        
        // Navegar a la página principal de AFIP
        await page.goto('https://auth.afip.gob.ar/contribuyente_/inicio.xhtml', {
          waitUntil: 'networkidle2'
        });
        
        // Esperar a que cargue la página de servicios
        await page.waitForSelector('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")');
        
        // Hacer clic en el enlace "Trámites a Distancia"
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
          page.click('a[title="Trámites a Distancia"], a:contains("Trámites a Distancia")')
        ]);
        
        // Esperar a que se cargue la página de TAD
        await page.waitForSelector('.tad-header, .header-tad, .tad-logo', { timeout: 60000 });
      }
      
      // Navegar a la sección de notificaciones en TAD
      logger.info('Navegando a la sección de notificaciones en TAD');
      
      // Buscar y hacer clic en la pestaña de notificaciones
      await page.waitForSelector('a[href*="notificaciones"], a:contains("Notificaciones"), button:contains("Notificaciones")');
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('a[href*="notificaciones"], a:contains("Notificaciones"), button:contains("Notificaciones")')
      ]);
      
      // Esperar a que cargue la tabla de notificaciones
      await page.waitForSelector('table.notificaciones, .notificaciones-table, .listado-notificaciones');
      
      // Configurar la descarga de archivos
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: path.dirname(outputPath)
      });
      
      // Buscar la notificación específica por ID y descargar
      const notificationFound = await page.evaluate((id) => {
        const filas = Array.from(document.querySelectorAll('table.notificaciones tr, .notificaciones-table tr, .listado-notificaciones .notificacion-item, .fila-notificacion'));
        
        for (const fila of filas) {
          // Intentar diferentes selectores para el ID
          const filaId = fila.querySelector('.id-notificacion, [data-id]')?.innerText.trim() || 
                        fila.getAttribute('data-id') || '';
          
          if (filaId === id) {
            // Encontrar el botón o enlace de descarga
            const downloadButton = fila.querySelector('a[href*="descargar"], a[href*="ver"], button.descargar, .icono-adjunto');
            
            if (downloadButton) {
              // Simular clic en el botón de descarga
              downloadButton.click();
              return true;
            }
          }
        }
        
        return false;
      }, notificationId);
      
      if (!notificationFound) {
        throw new Error(`Notificación ${notificationId} no encontrada`);
      }
      
      // Esperar a que se complete la descarga
      await page.waitForTimeout(5000);
      
      // Verificar si el archivo se descargó correctamente
      const downloadedFiles = fs.readdirSync(path.dirname(outputPath));
      const downloadedFile = downloadedFiles.find(file => file.includes('.pdf') || file.includes('.doc') || file.includes('.docx'));
      
      if (!downloadedFile) {
        throw new Error('No se pudo descargar el documento');
      }
      
      // Mover el archivo descargado a la ubicación deseada
      const downloadedFilePath = path.join(path.dirname(outputPath), downloadedFile);
      fs.renameSync(downloadedFilePath, outputPath);
      
      logger.info(`Documento de TAD guardado en ${outputPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Error descargando documento de TAD: ${error.message}`);
      await this._takeScreenshot(page, 'tad-download-error');
      throw error;
    }
  }

  // ===== MÉTODO PRINCIPAL PARA DESCARGAR DOCUMENTOS =====

  async downloadDocument(service, notificationId, sessionId, outputPath) {
    let page = null;
    
    try {
      logger.info(`Descargando documento ${service}:${notificationId} para sesión ${sessionId}`);
      
      // Verificar si la sesión existe
      if (!this.browserSessions.has(sessionId)) {
        return {
          success: false,
          message: "Sesión no encontrada o expirada"
        };
      }
      
      // Actualizar timestamp de actividad
      if (this.sessionData.has(sessionId)) {
        const sessionInfo = this.sessionData.get(sessionId);
        sessionInfo.lastActivity = Date.now();
        this.sessionData.set(sessionId, sessionInfo);
      }
      
      // Obtener el navegador de la sesión
      const browser = await this._getBrowser(sessionId);
      
      // Crear una nueva página
      page = await browser.newPage();
      await this._setupPage(page);
      
      // Asegurarse de que el directorio de destino existe
      const outputDir = path.dirname(outputPath);
      ensureDirectoryExists(outputDir);
      
      // Descargar documento según el servicio
      let success = false;
      
      switch (service.toLowerCase()) {
        case 'pjn':
          success = await this._downloadPJNDocument(page, notificationId, outputPath);
          break;
        case 'afip':
          success = await this._downloadAFIPDocument(page, notificationId, outputPath);
          break;
        case 'tad':
          success = await this._downloadTADDocument(page, notificationId, outputPath);
          break;
        default:
          throw new Error(`Servicio no soportado: ${service}`);
      }
      
      // Cerrar la página para liberar recursos
      await page.close();
      
      if (success) {
        return {
          success: true,
          filePath: outputPath,
          message: `Documento descargado exitosamente en ${outputPath}`
        };
      } else {
        return {
          success: false,
          message: "No se pudo descargar el documento"
        };
      }
    } catch (error) {
      logger.error(`Error al descargar documento ${service}:${notificationId}:`, error);
      
      // Intentar tomar screenshot en caso de error
      if (page) {
        await this._takeScreenshot(page, `${service}-download-error-${Date.now()}`);
        await page.close();
      }
      
      return {
        success: false,
        message: `Error al descargar documento: ${error.message}`
      };
    }
  }

  // ===== MÉTODO PARA LIMPIAR RECURSOS =====

  async cleanup() {
    try {
      logger.info('Limpiando recursos del ScraperManager');
      
      // Cerrar todos los navegadores
      for (const sessionId of this.browserSessions.keys()) {
        await this._closeBrowserSession(sessionId);
      }
      
      // Limpiar mapas
      this.browserSessions.clear();
      this.sessionTimeouts.clear();
      this.sessionData.clear();
      
      return true;
    } catch (error) {
      logger.error('Error al limpiar recursos:', error);
      return false;
    }
  }
}

module.exports = ScraperManager;