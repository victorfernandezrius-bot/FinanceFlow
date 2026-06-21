// Sistema de Gestión Contable - FinanceFlow SaaS
// Modelo contable profesional sin simulaciones

import Auth from './auth.js';
import PlanLimits from './plan-limits.js';
import DataClient from '../src/services/data-client.js';

class AccountingManager {
    constructor() {
        this.auth = Auth;            // referencia al sistema de auth
        this._accounts = [];         // caché síncrona de cuentas
        this._movements = [];        // caché síncrona de movimientos
        this._rules = [];            // caché síncrona de reglas de categorización
        this._notifications = [];    // caché síncrona de notificaciones
        this._loaded = false;
        this.accountTypes = {
            'activo': {
                label: 'Activo',
                description: 'Cuentas bancarias, efectivo, inversiones',
                hasInitialBalance: true,
                affects: 'balance_sheet',
                sign: 1,
                examples: ['Cuenta Corriente', 'Ahorros', 'Efectivo', 'Inversiones']
            },
            'pasivo': {
                label: 'Pasivo', 
                description: 'Deudas, préstamos, tarjetas de crédito',
                hasInitialBalance: true,
                affects: 'balance_sheet',
                sign: -1, // Los pasivos restan del patrimonio
                examples: ['Tarjeta de Crédito', 'Préstamo Hipotecario', 'Préstamo Personal']
            },
            'ingreso': {
                label: 'Ingreso',
                description: 'Fuentes de ingresos',
                hasInitialBalance: false,
                affects: 'income_statement',
                sign: 1,
                examples: ['Salario', 'Freelance', 'Inversiones', 'Otros Ingresos']
            },
            'gasto': {
                label: 'Gasto',
                description: 'Categorías de gastos',
                hasInitialBalance: false,
                affects: 'income_statement',
                sign: -1, // Los gastos restan del resultado
                examples: ['Alimentación', 'Transporte', 'Entretenimiento', 'Servicios']
            },
            'patrimonio': {
                label: 'Patrimonio Neto',
                description: 'Capital propio, reservas',
                hasInitialBalance: true,
                affects: 'balance_sheet',
                sign: 1,
                examples: ['Capital Inicial', 'Reservas', 'Resultados Acumulados']
            }
        };
    }

    // ===== CACHÉ DE DATOS (sincronización con DataClient) =====

    // Carga cuentas y movimientos en memoria. Llamar al iniciar el dashboard
    // y tras cualquier operación de escritura.
    async refresh() {
        const userId = this.auth.currentUser?.id;
        if (!userId) { this._accounts = []; this._movements = []; this._loaded = false; return; }
        this._accounts  = await DataClient.listAccounts(userId);
        this._movements = await DataClient.listMovements(userId);
        this._rules     = await DataClient.listRules(userId);
        this._notifications = await DataClient.getNotifications(userId);
        // Mantener sincronizada la caché de cuentas en Auth (para canCreateAccount)
        if (typeof this.auth.setAccountsCache === 'function') {
            this.auth.setAccountsCache(this._accounts);
        }
        this._loaded = true;
    }

    // ===== GESTIÓN DE CUENTAS =====

    async createAccount(accountData) {
        try {
            const { nombre, tipo, descripcion, saldo_inicial, is_fixed_cost, fixed_monthly_amount, fixed_due_day, is_bank_account } = accountData;

            // Validar autenticación
            if (!Auth.isAuthenticated()) {
                throw new Error('Debes estar autenticado para crear cuentas');
            }

            // Validar tipo de cuenta
            if (!this.accountTypes[tipo]) {
                throw new Error('Tipo de cuenta inválido');
            }

            // Validar límites del plan
            if (!Auth.canCreateAccount(tipo)) {
                const limits = Auth.getPlanLimits();
                const typeMap = {
                    'activo': 'cuentas bancarias',
                    'ingreso': 'cuentas de ingreso',
                    'gasto': 'cuentas de gasto',
                    'pasivo': 'cuentas de pasivo',
                    'patrimonio': 'cuentas de patrimonio'
                };
                throw new Error(`Has alcanzado el límite de ${typeMap[tipo]} de tu plan ${Auth.getUserPlan()}`);
            }

            // Validar campos de coste fijo (solo para cuentas de gasto)
            if (is_fixed_cost && tipo !== 'gasto') {
                throw new Error('Solo las cuentas de gasto pueden ser costes fijos');
            }
            
            if (is_fixed_cost) {
                if (!fixed_monthly_amount || fixed_monthly_amount <= 0) {
                    throw new Error('El importe mensual debe ser mayor que 0 para costes fijos');
                }
                if (!fixed_due_day || fixed_due_day < 1 || fixed_due_day > 31) {
                    throw new Error('El día de vencimiento debe estar entre 1 y 31');
                }
            }

            // Validar saldo inicial
            const accountTypeInfo = this.accountTypes[tipo];
            if (!accountTypeInfo.hasInitialBalance && saldo_inicial && saldo_inicial !== 0) {
                throw new Error(`Las cuentas de ${accountTypeInfo.label} no pueden tener saldo inicial`);
            }

            // Crear cuenta
            let initialBalance = 0;
            let currentBalance = 0;
            
            if (accountTypeInfo.hasInitialBalance) {
                initialBalance = saldo_inicial || 0;
                currentBalance = saldo_inicial || 0;
                
                // Para pasivos, convertir a negativo si es positivo (lógica contable)
                if (tipo === 'pasivo' && initialBalance > 0) {
                    initialBalance = -Math.abs(initialBalance);
                    currentBalance = -Math.abs(currentBalance);
                }
            }
            
            const newAccount = {
                id: crypto.randomUUID(),
                nombre: nombre.trim(),
                tipo,
                descripcion: descripcion?.trim() || '',
                saldo_inicial: initialBalance,
                saldo_actual: currentBalance,
                // Campos de coste fijo
                is_fixed_cost: tipo === 'gasto' ? (is_fixed_cost || false) : false,
                fixed_monthly_amount: (tipo === 'gasto' && is_fixed_cost) ? parseFloat(fixed_monthly_amount) : null,
                fixed_due_day: (tipo === 'gasto' && is_fixed_cost) ? parseInt(fixed_due_day) : null,
                // Campo de cuenta bancaria
                is_bank_account: tipo === 'activo' ? (is_bank_account || false) : false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            // Guardar cuenta
            await this.saveAccount(newAccount);

            return {
                success: true,
                account: newAccount,
                message: 'Cuenta creada correctamente'
            };

        } catch (error) {
            console.error('Error creando cuenta:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async saveAccount(account) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) {
            throw new Error('Usuario no autenticado');
        }

        await DataClient.saveAccount(currentUser.id, account);

        // Actualizar caché en memoria
        const i = this._accounts.findIndex(acc => acc.id === account.id);
        if (i >= 0) this._accounts[i] = account; else this._accounts.push(account);
        if (typeof this.auth.setAccountsCache === 'function') {
            this.auth.setAccountsCache(this._accounts);
        }
    }

    // SÍNCRONA: lee de la caché. Llama a refresh() antes si necesitas datos frescos.
    getAccounts(type = null) {
        const accounts = this._accounts || [];
        return type ? accounts.filter(acc => acc.tipo === type) : accounts;
    }

    getAccount(accountId) {
        return (this._accounts || []).find(acc => acc.id === accountId);
    }

    async updateAccount(accountId, updates) {
        if (!accountId) {
            throw new Error('ID de cuenta es requerido para actualizar');
        }
        
        const account = this.getAccount(accountId);
        if (!account) {
            throw new Error('Cuenta no encontrada');
        }

        const updatedAccount = {
            ...account,
            ...updates,
            id: account.id,
            updated_at: new Date().toISOString()
        };

        // Si cambió el saldo inicial, ajustar el saldo actual proporcionalmente
        // saldo_actual = saldo_inicial + movimientos_acumulados
        // Por tanto: nuevo_saldo_actual = nuevo_saldo_inicial + (saldo_actual_anterior - saldo_inicial_anterior)
        if (updates.saldo_inicial !== undefined && updates.saldo_inicial !== account.saldo_inicial) {
            const movimientosAcumulados = account.saldo_actual - account.saldo_inicial;
            updatedAccount.saldo_actual = updates.saldo_inicial + movimientosAcumulados;
        }

        await this.saveAccount(updatedAccount);
        
        return true;
    }

    async deleteAccount(accountId) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) {
            throw new Error('Usuario no autenticado');
        }

        await DataClient.deleteAccount(currentUser.id, accountId);

        // Actualizar caché
        this._accounts = this._accounts.filter(acc => acc.id !== accountId);
        if (typeof this.auth.setAccountsCache === 'function') {
            this.auth.setAccountsCache(this._accounts);
        }

        // También eliminar movimientos relacionados
        await this.deleteMovementsByAccount(accountId);
    }

    // ===== GESTIÓN DE MOVIMIENTOS =====

    async createMovement(movementData) {
        try {
            const { tipo, cantidad, descripcion, fecha, cuenta_id, cuenta_destino_id } = movementData;

            // Validar autenticación
            if (!Auth.isAuthenticated()) {
                throw new Error('Debes estar autenticado para crear movimientos');
            }

            // Validar datos básicos
            if (!tipo || !cantidad || !descripcion || !fecha) {
                throw new Error('Todos los campos son obligatorios');
            }

            if (cantidad <= 0) {
                throw new Error('La cantidad debe ser mayor a cero');
            }

            // Validar cuentas según el tipo de movimiento
            await this.validateMovementAccounts(tipo, cuenta_id, cuenta_destino_id);
            
            // Aplicar reglas de categorización automática (solo Premium)
            let processedMovementData = {
                tipo,
                cantidad: parseFloat(cantidad),
                descripcion: descripcion.trim(),
                fecha: fecha,
                cuenta_id,
                cuenta_destino_id,
                ...movementData // Incluir campos adicionales como auto_imported, etc.
            };
            
            // Solo aplicar reglas si no es un movimiento editado manualmente
            if (!movementData.manually_categorized) {
                processedMovementData = await this.applyCategorizationRules(processedMovementData);
            }

            // Crear movimiento
            const newMovement = {
                id: crypto.randomUUID(),
                ...processedMovementData,
                created_at: new Date().toISOString()
            };

            // Guardar movimiento y actualizar balances
            await this.saveMovement(newMovement);
            await this.updateAccountBalances(newMovement);

            return {
                success: true,
                movement: newMovement,
                message: 'Movimiento registrado correctamente'
            };

        } catch (error) {
            console.error('Error creando movimiento:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async validateMovementAccounts(tipo, cuentaId, cuentaDestinoId) {
        const cuentaOrigen = this.getAccount(cuentaId);
        const cuentaDestino = this.getAccount(cuentaDestinoId);

        if (!cuentaOrigen || !cuentaDestino) {
            throw new Error('Las cuentas seleccionadas no existen');
        }

        switch (tipo) {
            case 'ingreso':
                if (cuentaOrigen.tipo !== 'ingreso') {
                    throw new Error('La cuenta origen debe ser de tipo Ingreso');
                }
                if (cuentaDestino.tipo !== 'activo') {
                    throw new Error('La cuenta destino debe ser de tipo Activo');
                }
                break;

            case 'gasto':
                if (cuentaOrigen.tipo !== 'activo') {
                    throw new Error('La cuenta origen debe ser de tipo Activo');
                }
                if (cuentaDestino.tipo !== 'gasto') {
                    throw new Error('La cuenta destino debe ser de tipo Gasto');
                }
                break;

            case 'transferencia':
                if (!['activo', 'pasivo'].includes(cuentaOrigen.tipo)) {
                    throw new Error('La cuenta origen debe ser Activo o Pasivo');
                }
                if (!['activo', 'pasivo'].includes(cuentaDestino.tipo)) {
                    throw new Error('La cuenta destino debe ser Activo o Pasivo');
                }
                if (cuentaOrigen.id === cuentaDestino.id) {
                    throw new Error('Las cuentas origen y destino deben ser diferentes');
                }
                break;

            default:
                throw new Error('Tipo de movimiento no válido');
        }
    }

    async updateAccountBalances(movement) {
        const { tipo, cantidad, cuenta_id, cuenta_destino_id } = movement;
        
        const cuentaOrigen = this.getAccount(cuenta_id);
        const cuentaDestino = this.getAccount(cuenta_destino_id);

        switch (tipo) {
            case 'ingreso':
                // Aumenta el activo y el saldo acumulado del ingreso
                cuentaDestino.saldo_actual += cantidad; // Activo aumenta
                cuentaOrigen.saldo_actual += cantidad;  // Ingreso acumulado aumenta
                break;

            case 'gasto':
                // Disminuye el activo y aumenta el gasto acumulado
                cuentaOrigen.saldo_actual -= cantidad;  // Activo disminuye
                cuentaDestino.saldo_actual += cantidad; // Gasto acumulado aumenta
                break;

            case 'transferencia':
                // Lógica específica para transferencias entre activos/pasivos
                if (cuentaOrigen.tipo === 'activo' && cuentaDestino.tipo === 'activo') {
                    // Transferencia entre activos
                    cuentaOrigen.saldo_actual -= cantidad;
                    cuentaDestino.saldo_actual += cantidad;
                } else if (cuentaOrigen.tipo === 'activo' && cuentaDestino.tipo === 'pasivo') {
                    // Pago de deuda (activo → pasivo)
                    cuentaOrigen.saldo_actual -= cantidad;
                    cuentaDestino.saldo_actual += cantidad; // Reduce la deuda (menos negativo)
                } else if (cuentaOrigen.tipo === 'pasivo' && cuentaDestino.tipo === 'activo') {
                    // Endeudamiento (pasivo → activo)
                    cuentaOrigen.saldo_actual -= cantidad; // Aumenta la deuda (más negativo)
                    cuentaDestino.saldo_actual += cantidad;
                }
                break;
        }

        // Actualizar timestamps
        cuentaOrigen.updated_at = new Date().toISOString();
        cuentaDestino.updated_at = new Date().toISOString();

        // Guardar cambios
        await this.saveAccount(cuentaOrigen);
        await this.saveAccount(cuentaDestino);
    }

    // Recalcula el saldo_actual de TODAS las cuentas desde su saldo_inicial,
    // reaplicando todos los movimientos. Usar tras editar/borrar movimientos.
    async recalcAllBalances() {
        // Reiniciar saldos a su valor inicial
        const accounts = this._accounts || [];
        const byId = {};
        for (const acc of accounts) {
            acc.saldo_actual = acc.saldo_inicial || 0;
            byId[acc.id] = acc;
        }

        // Reaplicar cada movimiento (orden cronológico ascendente)
        const movimientos = [...(this._movements || [])]
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        for (const mov of movimientos) {
            const { tipo, cantidad, cuenta_id, cuenta_destino_id } = mov;
            const origen = byId[cuenta_id];
            const destino = byId[cuenta_destino_id];
            if (!origen || !destino) continue;

            switch (tipo) {
                case 'ingreso':
                    destino.saldo_actual += cantidad;
                    origen.saldo_actual += cantidad;
                    break;
                case 'gasto':
                    origen.saldo_actual -= cantidad;
                    destino.saldo_actual += cantidad;
                    break;
                case 'transferencia':
                    origen.saldo_actual -= cantidad;
                    destino.saldo_actual += cantidad;
                    break;
            }
        }

        // Persistir todas las cuentas actualizadas
        for (const acc of accounts) {
            acc.updated_at = new Date().toISOString();
            await DataClient.saveAccount(this.auth.currentUser.id, acc);
        }
        if (typeof this.auth.setAccountsCache === 'function') {
            this.auth.setAccountsCache(this._accounts);
        }
    }

    async saveMovement(movement) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) {
            throw new Error('Usuario no autenticado');
        }

        await DataClient.saveMovement(currentUser.id, movement);

        // Actualizar caché en memoria
        const i = this._movements.findIndex(m => m.id === movement.id);
        if (i >= 0) this._movements[i] = movement; else this._movements.push(movement);
    }

    // SÍNCRONA: lee de la caché, ordenada por fecha desc.
    getMovements(limit = null) {
        const movements = [...(this._movements || [])];
        movements.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        return limit ? movements.slice(0, limit) : movements;
    }

    getRecentMovements(limit = 5) {
        return this.getMovements(limit);
    }

    async deleteMovementsByAccount(accountId) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) return;

        // Identificar movimientos relacionados y borrarlos uno a uno
        const related = (this._movements || []).filter(mov =>
            mov.cuenta_id === accountId || mov.cuenta_destino_id === accountId
        );
        for (const mov of related) {
            await DataClient.deleteMovement(currentUser.id, mov.id);
        }
        // Actualizar caché
        this._movements = (this._movements || []).filter(mov =>
            mov.cuenta_id !== accountId && mov.cuenta_destino_id !== accountId
        );
    }

    // ===== CÁLCULOS FINANCIEROS =====

    calculateFinancialStats() {
        const accounts = this.getAccounts();
        const movements = this.getMovements();

        // Saldos por tipo de cuenta
        const activos = accounts
            .filter(acc => acc.tipo === 'activo')
            .reduce((sum, acc) => sum + acc.saldo_actual, 0);

        const pasivos = Math.abs(accounts
            .filter(acc => acc.tipo === 'pasivo')
            .reduce((sum, acc) => sum + acc.saldo_actual, 0));

        const patrimonio = accounts
            .filter(acc => acc.tipo === 'patrimonio')
            .reduce((sum, acc) => sum + acc.saldo_actual, 0);

        const ingresos = accounts
            .filter(acc => acc.tipo === 'ingreso')
            .reduce((sum, acc) => sum + acc.saldo_actual, 0);

        const gastos = accounts
            .filter(acc => acc.tipo === 'gasto')
            .reduce((sum, acc) => sum + acc.saldo_actual, 0);

        // Saldo total según fórmula contable correcta
        const saldoTotal = activos - pasivos + patrimonio + (ingresos - gastos);

        // Estadísticas del mes actual
        const thisMonth = new Date().toISOString().substring(0, 7);
        const movementsThisMonth = movements.filter(mov => 
            mov.fecha.substring(0, 7) === thisMonth
        );

        const ingresosMes = movementsThisMonth
            .filter(mov => mov.tipo === 'ingreso')
            .reduce((sum, mov) => sum + mov.cantidad, 0);

        const gastosMes = movementsThisMonth
            .filter(mov => mov.tipo === 'gasto')
            .reduce((sum, mov) => sum + mov.cantidad, 0);

        return {
            saldo_total: saldoTotal,
            activos_total: activos,
            pasivos_total: pasivos,
            patrimonio_total: patrimonio,
            ingresos_total: ingresos,
            gastos_total: gastos,
            ingresos_mes: ingresosMes,
            gastos_mes: gastosMes,
            balance_mes: ingresosMes - gastosMes,
            cuentas_count: accounts.length,
            movimientos_count: movements.length
        };
    }

    /**
     * Calcula estadísticas detalladas para un mes/año específico.
     * Devuelve totales globales + desglose por cuenta.
     * @param {number} year  - Ej: 2025
     * @param {number} month - 0-indexed (0=enero, 11=diciembre)
     */
    calculateMonthStats(year, month) {
        const movements = this.getMovements();
        const accounts  = this.getAccounts();

        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const movsMonth = movements.filter(m => m.fecha && m.fecha.startsWith(monthStr));

        // Totales globales del mes
        const ingresos = movsMonth.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.cantidad, 0);
        const gastos   = movsMonth.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.cantidad, 0);

        // Ingresos por cuenta origen (cuenta tipo ingreso)
        const ingresosPorCuenta = {};
        movsMonth.filter(m => m.tipo === 'ingreso').forEach(m => {
            const acc = accounts.find(a => a.id === m.cuenta_id);
            if (!acc) return;
            ingresosPorCuenta[acc.id] = ingresosPorCuenta[acc.id] || { nombre: acc.nombre, total: 0 };
            ingresosPorCuenta[acc.id].total += m.cantidad;
        });

        // Gastos por cuenta destino (cuenta tipo gasto)
        const gastosPorCuenta = {};
        movsMonth.filter(m => m.tipo === 'gasto').forEach(m => {
            const acc = accounts.find(a => a.id === m.cuenta_destino_id);
            if (!acc) return;
            gastosPorCuenta[acc.id] = gastosPorCuenta[acc.id] || { nombre: acc.nombre, total: 0 };
            gastosPorCuenta[acc.id].total += m.cantidad;
        });

        // Variación neta de activos durante el mes (calculada desde movimientos)
        const activosMov = {};
        movsMonth.forEach(m => {
            if (m.tipo === 'ingreso') {
                // La cuenta destino activo sube
                activosMov[m.cuenta_destino_id] = (activosMov[m.cuenta_destino_id] || 0) + m.cantidad;
            } else if (m.tipo === 'gasto') {
                // La cuenta origen activo baja
                activosMov[m.cuenta_id] = (activosMov[m.cuenta_id] || 0) - m.cantidad;
            } else if (m.tipo === 'transferencia') {
                activosMov[m.cuenta_id]         = (activosMov[m.cuenta_id]         || 0) - m.cantidad;
                activosMov[m.cuenta_destino_id] = (activosMov[m.cuenta_destino_id] || 0) + m.cantidad;
            }
        });

        // Variación neta de pasivos durante el mes
        const pasivosMov = {};
        movsMonth.filter(m => m.tipo === 'transferencia').forEach(m => {
            const destAcc = accounts.find(a => a.id === m.cuenta_destino_id);
            const origAcc = accounts.find(a => a.id === m.cuenta_id);
            if (destAcc?.tipo === 'pasivo') {
                // Pago de deuda: pasivo disminuye (positivo para el usuario)
                pasivosMov[m.cuenta_destino_id] = pasivosMov[m.cuenta_destino_id] || { nombre: destAcc.nombre, variacion: 0 };
                pasivosMov[m.cuenta_destino_id].variacion += m.cantidad;
            }
            if (origAcc?.tipo === 'pasivo') {
                // Endeudamiento: pasivo aumenta (negativo para el usuario)
                pasivosMov[m.cuenta_id] = pasivosMov[m.cuenta_id] || { nombre: origAcc.nombre, variacion: 0 };
                pasivosMov[m.cuenta_id].variacion -= m.cantidad;
            }
        });

        return {
            monthStr,
            ingresos_total: ingresos,
            gastos_total: gastos,
            resultado: ingresos - gastos,
            ingresos_por_cuenta: ingresosPorCuenta,
            gastos_por_cuenta: gastosPorCuenta,
            activos_variacion: activosMov,
            pasivos_variacion: pasivosMov,
            num_movimientos: movsMonth.length
        };
    }

    // ===== COSTES FIJOS Y SALDO REAL =====

    /**
     * Obtiene todas las cuentas de gasto que son costes fijos
     */
    getFixedCostAccounts() {
        const currentUser = this.auth.currentUser;
        if (!currentUser || !Auth.isPremium()) {
            return [];
        }
        
        return this.getAccounts('gasto').filter(acc => acc.is_fixed_cost === true);
    }

    /**
     * Calcula el total de costes fijos mensuales
     */
    calculateTotalFixedCosts() {
        const fixedCostAccounts = this.getFixedCostAccounts();
        return fixedCostAccounts.reduce((total, account) => {
            return total + (account.fixed_monthly_amount || 0);
        }, 0);
    }

    /**
     * Calcula los costes fijos pagados en el mes actual
     */
    calculatePaidFixedCosts(month = null, year = null) {
        const currentDate = new Date();
        const targetMonth = month !== null ? month : currentDate.getMonth();
        const targetYear = year !== null ? year : currentDate.getFullYear();
        
        const fixedCostAccounts = this.getFixedCostAccounts();
        const fixedCostAccountIds = fixedCostAccounts.map(acc => acc.id);
        
        const movements = this.getMovements();
        
        // Filtrar movimientos del mes actual para cuentas de coste fijo
        const monthlyFixedCostMovements = movements.filter(mov => {
            const movDate = new Date(mov.fecha);
            return movDate.getMonth() === targetMonth && 
                   movDate.getFullYear() === targetYear && 
                   mov.tipo === 'gasto' && 
                   fixedCostAccountIds.includes(mov.cuenta_destino_id);
        });

        return monthlyFixedCostMovements.reduce((total, mov) => total + mov.cantidad, 0);
    }

    /**
     * Calcula el saldo bancario total (solo cuentas de tipo 'activo')
     */
    calculateBankBalance() {
        const allActivos = this.getAccounts('activo');
        // Si hay cuentas marcadas como bancarias, usar solo esas
        const bankAccounts = allActivos.filter(acc => acc.is_bank_account === true || acc.is_bank_account === 1);
        const accountsToSum = bankAccounts.length > 0 ? bankAccounts : allActivos;
        return accountsToSum.reduce((total, account) => {
            return total + (account.saldo_actual || 0);
        }, 0);
    }

    /**
     * Calcula el Saldo Real = Saldo Bancario - (Costes Fijos Totales - Costes Fijos Pagados)
     */
    calculateSaldoReal() {
        const currentUser = this.auth.currentUser;
        if (!currentUser || !Auth.isPremium()) {
            return null; // Solo disponible para Premium
        }

        const saldoBancario = this.calculateBankBalance();
        const costesFijosTotales = this.calculateTotalFixedCosts();
        const costesFijosPagados = this.calculatePaidFixedCosts();
        
        const saldoReal = saldoBancario - (costesFijosTotales - costesFijosPagados);
        
        return {
            saldo_bancario: saldoBancario,
            costes_fijos_totales: costesFijosTotales,
            costes_fijos_pagados: costesFijosPagados,
            saldo_real: saldoReal
        };
    }

    // ===== REPORTES =====

    generateBalanceSheet() {
        const accounts = this.getAccounts();
        const stats = this.calculateFinancialStats();

        return {
            activos: accounts.filter(acc => acc.tipo === 'activo'),
            pasivos: accounts.filter(acc => acc.tipo === 'pasivo'),
            patrimonio: accounts.filter(acc => acc.tipo === 'patrimonio'),
            totales: {
                activos: stats.activos_total,
                pasivos: stats.pasivos_total,
                patrimonio: stats.patrimonio_total,
                patrimonio_neto: stats.saldo_total
            }
        };
    }

    generateIncomeStatement(period = 'current_month') {
        const accounts = this.getAccounts();
        const movements = this.getMovements();

        let filteredMovements = movements;
        
        if (period === 'current_month') {
            const thisMonth = new Date().toISOString().substring(0, 7);
            filteredMovements = movements.filter(mov => 
                mov.fecha.substring(0, 7) === thisMonth
            );
        }

        const ingresos = filteredMovements
            .filter(mov => mov.tipo === 'ingreso')
            .reduce((sum, mov) => sum + mov.cantidad, 0);

        const gastos = filteredMovements
            .filter(mov => mov.tipo === 'gasto')
            .reduce((sum, mov) => sum + mov.cantidad, 0);

        return {
            ingresos_cuentas: accounts.filter(acc => acc.tipo === 'ingreso'),
            gastos_cuentas: accounts.filter(acc => acc.tipo === 'gasto'),
            movimientos: filteredMovements,
            totales: {
                ingresos: ingresos,
                gastos: gastos,
                resultado: ingresos - gastos
            }
        };
    }

    // ===== CARGA DE DATOS =====

    async loadUserData() {
        // Refresca la caché desde DataClient y devuelve los datos
        await this.refresh();
        return {
            accounts: this.getAccounts(),
            movements: this.getMovements(),
            stats: this.calculateFinancialStats()
        };
    }

    // ===== UTILIDADES =====

    getAccountsByType(type) {
        return this.getAccounts().filter(acc => acc.tipo === type);
    }

    validateAccountName(name, excludeId = null) {
        const existingAccounts = this.getAccounts();
        return !existingAccounts.some(acc => 
            acc.nombre.toLowerCase() === name.toLowerCase() && 
            acc.id !== excludeId
        );
    }

    getAccountTypesInfo() {
        return this.accountTypes;
    }
    
    // ===== IMPORTACIÓN AUTOMÁTICA BANCARIA =====
    
    async importBankMovements(bankConnection) {
        if (!window.BANK_SIMULATOR_ENABLED) {
            console.warn('[BankSimulator] Desactivado. Se reemplaza por GoCardless en Fase 2.');
            return { success: false, error: 'Conexión bancaria disponible en breve' };
        }
        
        try {
            if (!Auth.isPremium()) {
                throw new Error('La importación automática requiere Premium');
            }
            
            if (!bankConnection || !bankConnection.isActive) {
                return {
                    success: false,
                    error: 'No hay cuenta bancaria conectada'
                };
            }
            
            // Generar movimientos bancarios simulados
            const simulatedMovements = this.generateSimulatedBankMovements(bankConnection);
            
            let importedCount = 0;
            let duplicatesSkipped = 0;
            const importedMovements = [];
            
            for (const bankMovement of simulatedMovements) {
                // Verificar si el movimiento ya existe (prevenir duplicados)
                if (!this.isMovementDuplicate(bankMovement)) {
                    // Convertir movimiento bancario a formato contable
                    const accountingMovement = this.convertBankMovementToAccounting(bankMovement, bankConnection);
                    
                    if (accountingMovement) {
                        // Usar la lógica existente de createMovement
                        const result = await this.createMovement(accountingMovement);
                        if (result.success) {
                            importedMovements.push(result.movement);
                            importedCount++;
                        }
                    }
                } else {
                    duplicatesSkipped++;
                }
            }
            
            // Actualizar información de importación
            this.updateImportInfo(bankConnection, importedCount);
            
            const result = {
                success: true,
                importedCount,
                duplicatesSkipped,
                movements: importedMovements,
                message: `Se importaron ${importedCount} movimientos nuevos`
            };
            
            // Generar notificación de importación completada
            this.notifyImportCompleted(result);
            
            return result;
            
        } catch (error) {
            console.error('Error en importación automática:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    generateSimulatedBankMovements(bankConnection) {
        if (!window.BANK_SIMULATOR_ENABLED) {
            return [];
        }
        // Generar movimientos bancarios simulados realistas
        const movements = [];
        const today = new Date();
        
        // Solo generar movimientos de los últimos 7 días si no se han importado antes
        const lastImport = this.getLastImportInfo(bankConnection);
        const daysSinceLastImport = lastImport ? 
            Math.floor((today - new Date(lastImport.lastImportDate)) / (1000 * 60 * 60 * 24)) : 7;
        
        const daysToImport = Math.min(daysSinceLastImport, 7);
        
        // Generar 1-3 movimientos por día
        for (let i = 0; i < daysToImport; i++) {
            const movementDate = new Date(today);
            movementDate.setDate(today.getDate() - i);
            
            const dailyMovements = Math.floor(Math.random() * 3) + 1;
            
            for (let j = 0; j < dailyMovements; j++) {
                const movement = this.generateRandomBankMovement(movementDate, bankConnection);
                movements.push(movement);
            }
        }
        
        return movements;
    }
    
    generateRandomBankMovement(date, bankConnection) {
        // Tipos de movimientos bancarios comunes
        const movementTypes = [
            { type: 'ingreso', description: 'Salario', amount: () => Math.random() * 1000 + 2000 },
            { type: 'gasto', description: 'Supermercado', amount: () => Math.random() * 80 + 20 },
            { type: 'gasto', description: 'Gasolina', amount: () => Math.random() * 50 + 30 },
            { type: 'gasto', description: 'Restaurante', amount: () => Math.random() * 40 + 15 },
            { type: 'ingreso', description: 'Transferencia', amount: () => Math.random() * 200 + 50 },
            { type: 'gasto', description: 'Farmacia', amount: () => Math.random() * 25 + 10 },
            { type: 'gasto', description: 'Transporte público', amount: () => Math.random() * 15 + 5 }
        ];
        
        const selectedType = movementTypes[Math.floor(Math.random() * movementTypes.length)];
        
        return {
            id: `bank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            date: date.toISOString().split('T')[0],
            description: selectedType.description,
            amount: parseFloat(selectedType.amount().toFixed(2)),
            type: selectedType.type,
            bankReference: `REF${Date.now()}${Math.floor(Math.random() * 1000)}`,
            bankConnection: bankConnection.bankCode
        };
    }
    
    isMovementDuplicate(bankMovement) {
        const existingMovements = this.getMovements();
        
        // Verificar duplicados por referencia bancaria o por combinación de fecha+descripción+importe
        return existingMovements.some(movement => {
            // Verificar por referencia bancaria si existe
            if (movement.bank_reference && bankMovement.bankReference) {
                return movement.bank_reference === bankMovement.bankReference;
            }
            
            // Verificar por combinación fecha + descripción + cantidad (mismo día)
            return movement.fecha === bankMovement.date &&
                   movement.descripcion.toLowerCase() === bankMovement.description.toLowerCase() &&
                   movement.cantidad === bankMovement.amount;
        });
    }
    
    convertBankMovementToAccounting(bankMovement, bankConnection) {
        // Buscar cuenta activa del banco conectado (cuenta corriente/ahorro)
        const bankAccount = this.findOrCreateBankAccount(bankConnection);
        
        if (!bankAccount) {
            console.warn('No se pudo encontrar o crear cuenta bancaria para importación');
            return null;
        }
        
        // Buscar cuenta de categoría apropiada
        const categoryAccount = this.findCategoryAccountForMovement(bankMovement);
        
        if (!categoryAccount) {
            console.warn('No se pudo determinar cuenta de categoría para movimiento:', bankMovement.description);
            return null;
        }
        
        // Convertir a formato de movimiento contable
        return {
            tipo: bankMovement.type === 'ingreso' ? 'ingreso' : 'gasto',
            cantidad: bankMovement.amount,
            descripcion: `${bankMovement.description} (Auto-importado)`,
            fecha: bankMovement.date,
            cuenta_id: bankMovement.type === 'ingreso' ? categoryAccount.id : bankAccount.id,
            cuenta_destino_id: bankMovement.type === 'ingreso' ? bankAccount.id : categoryAccount.id,
            bank_reference: bankMovement.bankReference,
            auto_imported: true
        };
    }
    
    findOrCreateBankAccount(bankConnection) {
        const accounts = this.getAccounts();
        
        // Buscar cuenta existente del banco
        let bankAccount = accounts.find(acc => 
            acc.tipo === 'activo' && 
            acc.nombre.toLowerCase().includes(bankConnection.bankName.toLowerCase().split(' ')[1] || bankConnection.bankName.toLowerCase())
        );
        
        // Si no existe, crear una cuenta bancaria automáticamente
        if (!bankAccount) {
            const accountData = {
                nombre: `${bankConnection.bankName} - ${bankConnection.accountType}`,
                tipo: 'activo',
                saldo_inicial: 0,
                descripcion: `Cuenta conectada automáticamente`,
                auto_created: true
            };
            
            try {
                const result = this.createAccount(accountData);
                if (result.success) {
                    bankAccount = result.account;
                }
            } catch (error) {
                console.error('Error creando cuenta bancaria automática:', error);
                return null;
            }
        }
        
        return bankAccount;
    }
    
    findCategoryAccountForMovement(bankMovement) {
        const accounts = this.getAccounts();
        
        // Mapeo inteligente de descripciones a categorías
        const categoryMappings = {
            'salario': 'ingreso',
            'nomina': 'ingreso', 
            'transferencia': 'ingreso',
            'supermercado': 'gasto',
            'alimentación': 'gasto',
            'gasolina': 'gasto',
            'combustible': 'gasto',
            'restaurante': 'gasto',
            'comida': 'gasto',
            'transporte': 'gasto',
            'farmacia': 'gasto',
            'salud': 'gasto'
        };
        
        const description = bankMovement.description.toLowerCase();
        let targetType = bankMovement.type;
        
        // Buscar cuenta existente por descripción
        for (const [keyword, type] of Object.entries(categoryMappings)) {
            if (description.includes(keyword)) {
                targetType = type;
                break;
            }
        }
        
        // Buscar cuenta del tipo apropiado
        const categoryAccounts = accounts.filter(acc => acc.tipo === targetType);
        
        if (categoryAccounts.length > 0) {
            // Priorizar cuentas que contengan palabras clave en el nombre
            for (const [keyword] of Object.entries(categoryMappings)) {
                const matchingAccount = categoryAccounts.find(acc => 
                    acc.nombre.toLowerCase().includes(keyword)
                );
                if (matchingAccount) return matchingAccount;
            }
            
            // Si no hay coincidencia, usar la primera cuenta del tipo
            return categoryAccounts[0];
        }
        
        return null;
    }
    
    async updateImportInfo(bankConnection, importedCount) {
        const importInfo = {
            lastImportDate: new Date().toISOString(),
            lastImportCount: importedCount,
            totalImported: ((await DataClient.getImportInfo(this.auth.currentUser?.id, bankConnection.bankCode))?.totalImported || 0) + importedCount
        };
        
        await DataClient.saveImportInfo(this.auth.currentUser?.id, bankConnection.bankCode, importInfo);
    }
    
    async getLastImportInfo(bankConnection) {
        return await DataClient.getImportInfo(this.auth.currentUser?.id, bankConnection.bankCode);
    }
    
    // ===== SISTEMA DE REGLAS DE CATEGORIZACIÓN =====
    
    getCategorizeRules() {
        if (!Auth.isPremium()) {
            return [];
        }
        // Leer de caché; si no hay reglas, generar las por defecto (sin persistir aquí)
        if (this._rules && this._rules.length > 0) {
            return this._rules;
        }
        return this.initializeDefaultRules();
    }
    
    initializeDefaultRules() {
        console.log('🔧 Inicializando reglas por defecto SIN crear cuentas');
        
        // Obtener cuentas del usuario
        const accounts = this.getAccounts();
        
        // Función helper para BUSCAR cuenta (NO crear)
        const findAccount = (sugerencias, tipo) => {
            // Intentar encontrar cuenta que coincida con sugerencias
            for (const sugerencia of sugerencias) {
                const account = accounts.find(acc => 
                    acc.nombre.toLowerCase().includes(sugerencia.toLowerCase()) && 
                    acc.tipo === tipo
                );
                if (account) {
                    console.log(`✅ Cuenta encontrada: "${account.nombre}" para sugerencia "${sugerencia}"`);
                    return account;
                }
            }
            console.log(`⚠️ No se encontró cuenta para ${tipo} con sugerencias:`, sugerencias);
            return null;
        };
        
        // Definir reglas por defecto SIN cuentas asociadas (usuario las asignará manualmente)
        const defaultRules = [
            {
                id: 'rule_salary',
                name: 'Salarios y Nóminas',
                keywords: ['salario', 'nomina', 'nómina', 'sueldo', 'pago empresa'],
                accountType: 'ingreso',
                accountId: findAccount(['salario', 'nómina', 'sueldo'], 'ingreso')?.id || null,
                accountName: 'Salario (sugerido)',
                enabled: true,
                isDefault: true
            },
            {
                id: 'rule_supermarket',
                name: 'Supermercados',
                keywords: ['mercadona', 'carrefour', 'alcampo', 'dia', 'lidl', 'supermercado', 'alimentación'],
                accountType: 'gasto',
                accountId: findAccount(['alimentación', 'comida', 'supermercado'], 'gasto')?.id || null,
                accountName: 'Alimentación (sugerido)',
                enabled: true,
                isDefault: true
            },
            {
                id: 'rule_gas',
                name: 'Gasolineras',
                keywords: ['repsol', 'cepsa', 'bp', 'shell', 'gasolina', 'combustible'],
                accountType: 'gasto',
                accountId: findAccount(['gasolina', 'combustible', 'transporte'], 'gasto')?.id || null,
                accountName: 'Gasolina (sugerido)',
                enabled: true,
                isDefault: true
            },
            {
                id: 'rule_transport',
                name: 'Transporte Público',
                keywords: ['metro', 'bus', 'tren', 'taxi', 'uber', 'cabify'],
                accountType: 'gasto',
                accountId: findAccount(['transporte', 'movilidad'], 'gasto')?.id || null,
                accountName: 'Transporte (sugerido)',
                enabled: true,
                isDefault: true
            },
            {
                id: 'rule_restaurants',
                name: 'Restaurantes y Bares',
                keywords: ['restaurante', 'bar', 'cafetería', 'mcdonald', 'burger', 'pizza'],
                accountType: 'gasto',
                accountId: findAccount(['restaurantes', 'ocio', 'comida fuera'], 'gasto')?.id || null,
                accountName: 'Restaurantes (sugerido)',
                enabled: true,
                isDefault: true
            },
            {
                id: 'rule_subscriptions',
                name: 'Suscripciones',
                keywords: ['netflix', 'spotify', 'amazon prime', 'disney', 'suscripción'],
                accountType: 'gasto',
                accountId: findAccount(['suscripciones', 'servicios', 'entretenimiento'], 'gasto')?.id || null,
                accountName: 'Suscripciones (sugerido)',
                enabled: true,
                isDefault: true
            }
        ];
        
        // Cachear las reglas por defecto (NO persistir automáticamente aquí para
        // no escribir en disco en cada lectura; se persisten al modificarlas).
        this._rules = defaultRules;
        return defaultRules;
    }
    
    async saveCategorizeRules(rules) {
        if (!Auth.isPremium()) {
            throw new Error('Las reglas de categorización requieren Premium');
        }
        
        await DataClient.saveRules(this.auth.currentUser?.id, rules);
        return { success: true };
    }
    
    async addCategorizeRule(rule) {
        if (!Auth.isPremium()) {
            throw new Error('Las reglas de categorización requieren Premium');
        }
        
        const rules = this.getCategorizeRules();
        const newRule = {
            id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: rule.name,
            keywords: rule.keywords.map(k => k.toLowerCase().trim()).filter(k => k.length > 0),
            accountType: rule.accountType,
            accountName: rule.accountName,
            accountId: rule.accountId ?? null,
            enabled: true,
            isDefault: false,
            createdAt: new Date().toISOString()
        };
        
        rules.push(newRule);
        await this.saveCategorizeRules(rules);
        
        return { success: true, rule: newRule };
    }
    
    async updateCategorizeRule(ruleId, updates) {
        if (!Auth.isPremium()) {
            throw new Error('Las reglas de categorización requieren Premium');
        }
        
        const rules = this.getCategorizeRules();
        const ruleIndex = rules.findIndex(r => r.id === ruleId);
        
        if (ruleIndex === -1) {
            throw new Error('Regla no encontrada');
        }
        
        // Todas las reglas (por defecto y de usuario) se pueden editar por completo:
        // nombre, palabras clave y cuenta asignada.
        rules[ruleIndex] = { ...rules[ruleIndex], ...updates };
        await this.saveCategorizeRules(rules);
        
        return { success: true, rule: rules[ruleIndex] };
    }
    
    async deleteCategorizeRule(ruleId) {
        if (!Auth.isPremium()) {
            throw new Error('Las reglas de categorización requieren Premium');
        }
        
        const rules = this.getCategorizeRules();
        const ruleIndex = rules.findIndex(r => r.id === ruleId);
        
        if (ruleIndex === -1) {
            throw new Error('Regla no encontrada');
        }
        
        // No permitir eliminar reglas por defecto
        if (rules[ruleIndex].isDefault === true || rules[ruleIndex].isDefault === 1) {
            throw new Error('No se pueden eliminar reglas por defecto');
        }
        
        rules.splice(ruleIndex, 1);
        await this.saveCategorizeRules(rules);
        
        return { success: true };
    }
    
    // Normaliza texto para el match de reglas: minúsculas y sin acentos/diacríticos.
    // Así "NÓMINA JUNIO" matchea la keyword "nomina" y viceversa.
    _normalizeText(text) {
        return (text || '')
            .toString()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    // Devuelve la primera regla activa cuya keyword aparece en la descripción,
    // SIN efectos secundarios (no crea cuentas). Útil para previsualizar importaciones.
    findMatchingRule(descripcion) {
        if (!Auth.isPremium()) return null;
        const rules = this.getCategorizeRules().filter(rule => rule.enabled === true || rule.enabled === 1);
        const description = this._normalizeText(descripcion);
        return rules.find(rule =>
            rule.keywords.some(keyword => description.includes(this._normalizeText(keyword)))
        ) || null;
    }

    async applyCategorizationRules(movementData) {
        // Solo aplicar a usuarios Premium
        if (!Auth.isPremium()) {
            return movementData;
        }

        // No aplicar si el movimiento ya tiene categoría manual
        if (movementData.manually_categorized) {
            return movementData;
        }

        // Blindar enabled: en remoto (D1) puede llegar como entero 1/0; en local como booleano.
        const rules = this.getCategorizeRules().filter(rule => rule.enabled === true || rule.enabled === 1);
        // Normalizar la descripción (minúsculas + sin acentos) para un match robusto.
        const description = this._normalizeText(movementData.descripcion);

        // Buscar primera regla que coincida
        for (const rule of rules) {
            const matchesKeyword = rule.keywords.some(keyword =>
                description.includes(this._normalizeText(keyword))
            );
            
            if (matchesKeyword) {
                // Resolver la cuenta de la regla (solo cuentas válidas existentes; no se crea ninguna)
                const targetAccount = await this.resolveRuleAccount(rule);
                
                if (targetAccount) {
                    // Aplicar categorización automática
                    const categorizedMovement = { ...movementData };
                    
                    if (rule.accountType === 'ingreso') {
                        categorizedMovement.cuenta_id = targetAccount.id;
                    } else {
                        categorizedMovement.cuenta_destino_id = targetAccount.id;
                    }
                    
                    // Marcar como categorizado automáticamente
                    categorizedMovement.auto_categorized = true;
                    categorizedMovement.applied_rule = rule.id;
                    categorizedMovement.rule_name = rule.name;
                    
                    return categorizedMovement;
                }
            }
        }
        
        return movementData;
    }
    
    // Resuelve la cuenta asociada a una regla SIN efectos secundarios:
    // primero por accountId, y si no, por nombre+tipo (case-insensitive y sin acentos).
    getRuleAccount(rule) {
        if (!rule) return null;
        const accounts = this.getAccounts();
        if (rule.accountId) {
            const byId = accounts.find(acc => acc.id === rule.accountId);
            if (byId) return byId;
        }
        if (rule.accountName) {
            const name = this._normalizeText(rule.accountName);
            return accounts.find(acc =>
                acc.tipo === rule.accountType && this._normalizeText(acc.nombre) === name
            ) || null;
        }
        return null;
    }

    // Auto-repara reglas antiguas: rellena accountId resolviendo por nombre+tipo.
    // Persiste una sola vez si hubo cambios. Devuelve cuántas reglas reparó.
    async repairRuleAccountIds() {
        if (!Auth.isPremium()) return 0;
        const rules = this.getCategorizeRules();
        let repaired = 0;
        for (const rule of rules) {
            if (!rule.accountId && rule.accountName) {
                const account = this.getRuleAccount(rule);
                if (account) { rule.accountId = account.id; repaired++; }
            }
        }
        if (repaired > 0) await this.saveCategorizeRules(rules);
        return repaired;
    }

    // Resuelve la cuenta de una regla usando SOLO cuentas reales existentes
    // (por accountId o por nombre+tipo). NUNCA crea cuentas automáticamente:
    // la creación ocurre únicamente por el flujo válido del modal de Cuentas.
    // Si la regla no apunta a una cuenta válida, devuelve null y no se categoriza.
    async resolveRuleAccount(rule) {
        const existing = this.getRuleAccount(rule);
        if (!existing) return null;
        // Persistir el accountId en la regla para no repetir la búsqueda en cada movimiento.
        if (rule.accountId !== existing.id) {
            rule.accountId = existing.id;
            try { await this.updateCategorizeRule(rule.id, { accountId: existing.id }); } catch (e) { /* no bloquear */ }
        }
        return existing;
    }
    
    // ===== SISTEMA DE NOTIFICACIONES INTERNAS =====
    
    // SÍNCRONA: lee de caché
    getNotifications() {
        if (!Auth.isPremium()) {
            return [];
        }
        return this._notifications || [];
    }

    // Persiste la caché de notificaciones vía DataClient
    async _persistNotifications() {
        await DataClient.saveNotifications(this.auth.currentUser?.id, this._notifications || []);
    }

    async addNotification(type, title, message, data = {}) {
        if (!Auth.isPremium()) {
            return { success: false, error: 'Las notificaciones requieren Premium' };
        }

        const newNotification = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: type,
            title: title,
            message: message,
            data: data,
            read: false,
            createdAt: new Date().toISOString()
        };

        this._notifications = [newNotification, ...(this._notifications || [])].slice(0, 50);
        await this._persistNotifications();

        return { success: true, notification: newNotification };
    }

    async markNotificationAsRead(notificationId) {
        if (!Auth.isPremium()) {
            return { success: false };
        }

        const notification = (this._notifications || []).find(n => n.id === notificationId);
        if (notification) {
            notification.read = true;
            await this._persistNotifications();
            return { success: true };
        }
        return { success: false };
    }

    async markAllNotificationsAsRead() {
        if (!Auth.isPremium()) {
            return { success: false };
        }

        (this._notifications || []).forEach(n => n.read = true);
        await this._persistNotifications();
        return { success: true };
    }

    getUnreadNotificationsCount() {
        if (!Auth.isPremium()) {
            return 0;
        }
        return (this._notifications || []).filter(n => !n.read).length;
    }

    async deleteNotification(notificationId) {
        if (!Auth.isPremium()) {
            return { success: false };
        }

        this._notifications = (this._notifications || []).filter(n => n.id !== notificationId);
        await this._persistNotifications();
        return { success: true };
    }
    
    // Notificaciones específicas del Plan de Autocontrol
    checkAutocontrolLimits(autocontrolData) {
        if (!Auth.isPremium() || !autocontrolData) {
            return;
        }
        
        const { ingresoMensual, savings, investment, needs, leisure } = autocontrolData;
        
        if (!ingresoMensual || ingresoMensual <= 0) {
            return;
        }
        
        // Calcular importes objetivo
        const savingsTarget = (ingresoMensual * savings) / 100;
        const investmentTarget = (ingresoMensual * investment) / 100;
        const needsTarget = (ingresoMensual * needs) / 100;
        const leisureTarget = (ingresoMensual * leisure) / 100;
        
        // Obtener gastos reales del mes actual
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const movements = this.getMovements().filter(m => m.fecha.startsWith(currentMonth));
        
        // Calcular gastos por categoría (simulado - en realidad necesitaría asociaciones)
        const actualExpenses = {
            needs: this.calculateCategoryExpenses(movements, 'needs'),
            leisure: this.calculateCategoryExpenses(movements, 'leisure')
        };
        
        // Verificar límites superados
        if (actualExpenses.needs > needsTarget) {
            const excess = actualExpenses.needs - needsTarget;
            this.addNotification(
                'autocontrol_limit',
                'Límite de Necesidades Superado',
                `Has gastado €${actualExpenses.needs.toFixed(2)} en necesidades, superando tu límite de €${needsTarget.toFixed(2)} por €${excess.toFixed(2)}.`,
                { category: 'needs', target: needsTarget, actual: actualExpenses.needs, excess: excess }
            );
        }
        
        if (actualExpenses.leisure > leisureTarget) {
            const excess = actualExpenses.leisure - leisureTarget;
            this.addNotification(
                'autocontrol_limit',
                'Límite de Ocio Superado',
                `Has gastado €${actualExpenses.leisure.toFixed(2)} en ocio, superando tu límite de €${leisureTarget.toFixed(2)} por €${excess.toFixed(2)}.`,
                { category: 'leisure', target: leisureTarget, actual: actualExpenses.leisure, excess: excess }
            );
        }
    }
    
    calculateCategoryExpenses(movements, category) {
        // Simulación básica - en implementación real usaría las asociaciones de cuentas
        const categoryKeywords = {
            'needs': ['alimentación', 'supermercado', 'farmacia', 'transporte'],
            'leisure': ['restaurante', 'entretenimiento', 'ocio', 'cine']
        };
        
        const keywords = categoryKeywords[category] || [];
        
        return movements
            .filter(m => m.tipo === 'gasto')
            .filter(m => keywords.some(keyword => 
                m.descripcion.toLowerCase().includes(keyword)
            ))
            .reduce((total, m) => total + m.cantidad, 0);
    }
    
    // Notificación para importaciones automáticas
    notifyImportCompleted(importResult) {
        if (!Auth.isPremium() || !importResult.success) {
            return;
        }
        
        const { importedCount, duplicatesSkipped } = importResult;
        
        if (importedCount > 0) {
            this.addNotification(
                'import_completed',
                'Importación Completada',
                `Se importaron ${importedCount} movimientos nuevos. ${duplicatesSkipped > 0 ? `${duplicatesSkipped} duplicados omitidos.` : ''}`,
                { importedCount, duplicatesSkipped, timestamp: new Date().toISOString() }
            );
        }
    }
    
    // ===== EXPORTACIÓN DE DATOS =====
    
    async exportData(type, format, options = {}) {
        if (!Auth.isPremium()) {
            throw new Error('La exportación de datos requiere Premium');
        }
        
        const { startDate, endDate } = options;
        
        try {
            let data = [];
            let filename = '';
            
            switch (type) {
                case 'movements':
                    data = this.prepareMovementsForExport(startDate, endDate);
                    filename = `movimientos_${this.formatDateForFilename(startDate)}_${this.formatDateForFilename(endDate)}`;
                    break;
                case 'accounts':
                    data = this.prepareAccountsForExport();
                    filename = `cuentas_${this.formatDateForFilename()}`;
                    break;
                case 'balance':
                    data = this.prepareBalanceForExport();
                    filename = `balance_${this.formatDateForFilename()}`;
                    break;
                default:
                    throw new Error('Tipo de exportación no válido');
            }
            
            if (format === 'csv') {
                return this.exportToCSV(data, filename);
            } else if (format === 'excel') {
                return this.exportToExcel(data, filename, type);
            } else {
                throw new Error('Formato de exportación no válido');
            }
            
        } catch (error) {
            console.error('Error en exportación:', error);
            throw error;
        }
    }
    
    prepareMovementsForExport(startDate, endDate) {
        let movements = this.getMovements();
        
        // Filtrar por fechas si se especifican
        if (startDate) {
            movements = movements.filter(m => m.fecha >= startDate);
        }
        if (endDate) {
            movements = movements.filter(m => m.fecha <= endDate);
        }
        
        // Ordenar por fecha
        movements.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        
        // Obtener cuentas para los nombres
        const accounts = this.getAccounts();
        const accountsMap = {};
        accounts.forEach(acc => {
            accountsMap[acc.id] = acc.nombre;
        });
        
        // Preparar datos para exportación contable profesional
        let saldoAcumulado = 0;
        
        return movements.map(movement => {
            saldoAcumulado += parseFloat(movement.cantidad) || 0;
            
            return {
                'Fecha': this.formatDateForExport(movement.fecha),
                'Cuenta': accountsMap[movement.cuenta_id] || 'No especificada',
                'Tipo': movement.tipo,
                'Categoría': movement.tipo === 'ingreso' ? 'Ingresos' : movement.tipo === 'gasto' ? 'Gastos' : 'Transferencia',
                'Descripción': movement.descripcion,
                'Importe': parseFloat(movement.cantidad) || 0,
                'Saldo': saldoAcumulado
            };
        });
    }
    
    prepareAccountsForExport() {
        const accounts = this.getAccounts();
        
        return accounts.map(account => ({
            'Nombre': account.nombre,
            'Tipo': account.tipo,
            'Saldo Inicial': parseFloat(account.saldo_inicial) || 0,
            'Saldo Actual': parseFloat(account.saldo_actual) || 0,
            'Descripción': account.descripcion || ''
        }));
    }
    
    prepareBalanceForExport() {
        const accounts = this.getAccounts();
        const stats = this.calculateFinancialStats();

        // Tipos en minúsculas — igual que como los guarda la app
        const activos    = accounts.filter(acc => acc.tipo === 'activo');
        const pasivos    = accounts.filter(acc => acc.tipo === 'pasivo');
        const patrimonio = accounts.filter(acc => acc.tipo === 'patrimonio');
        const ingresos   = accounts.filter(acc => acc.tipo === 'ingreso');
        const gastos     = accounts.filter(acc => acc.tipo === 'gasto');

        const balanceData = [];

        // ACTIVOS
        balanceData.push({ 'Tipo': 'ACTIVOS', 'Cuenta': '', 'Saldo': '' });
        let totalActivos = 0;
        activos.forEach(acc => {
            const saldo = acc.saldo_actual || 0;
            totalActivos += saldo;
            balanceData.push({ 'Tipo': 'Activo', 'Cuenta': acc.nombre, 'Saldo': saldo });
        });
        balanceData.push({ 'Tipo': '', 'Cuenta': 'TOTAL ACTIVOS', 'Saldo': totalActivos });
        balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });

        // PASIVOS
        balanceData.push({ 'Tipo': 'PASIVOS', 'Cuenta': '', 'Saldo': '' });
        let totalPasivos = 0;
        pasivos.forEach(acc => {
            const saldo = Math.abs(acc.saldo_actual || 0);
            totalPasivos += saldo;
            balanceData.push({ 'Tipo': 'Pasivo', 'Cuenta': acc.nombre, 'Saldo': saldo });
        });
        balanceData.push({ 'Tipo': '', 'Cuenta': 'TOTAL PASIVOS', 'Saldo': totalPasivos });
        balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });

        // PATRIMONIO
        if (patrimonio.length > 0) {
            balanceData.push({ 'Tipo': 'PATRIMONIO', 'Cuenta': '', 'Saldo': '' });
            let totalPatrimonio = 0;
            patrimonio.forEach(acc => {
                const saldo = acc.saldo_actual || 0;
                totalPatrimonio += saldo;
                balanceData.push({ 'Tipo': 'Patrimonio', 'Cuenta': acc.nombre, 'Saldo': saldo });
            });
            balanceData.push({ 'Tipo': '', 'Cuenta': 'TOTAL PATRIMONIO', 'Saldo': totalPatrimonio });
            balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });
        }

        // PATRIMONIO NETO (calculado)
        const patrimonioNeto = totalActivos - totalPasivos + (stats.patrimonio_total || 0);
        balanceData.push({ 'Tipo': '', 'Cuenta': 'PATRIMONIO NETO', 'Saldo': patrimonioNeto });
        balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });

        // INGRESOS
        balanceData.push({ 'Tipo': 'INGRESOS', 'Cuenta': '', 'Saldo': '' });
        let totalIngresos = 0;
        ingresos.forEach(acc => {
            const saldo = acc.saldo_actual || 0;
            totalIngresos += saldo;
            balanceData.push({ 'Tipo': 'Ingreso', 'Cuenta': acc.nombre, 'Saldo': saldo });
        });
        balanceData.push({ 'Tipo': '', 'Cuenta': 'TOTAL INGRESOS', 'Saldo': totalIngresos });
        balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });

        // GASTOS
        balanceData.push({ 'Tipo': 'GASTOS', 'Cuenta': '', 'Saldo': '' });
        let totalGastos = 0;
        gastos.forEach(acc => {
            const saldo = acc.saldo_actual || 0;
            totalGastos += saldo;
            balanceData.push({ 'Tipo': 'Gasto', 'Cuenta': acc.nombre, 'Saldo': saldo });
        });
        balanceData.push({ 'Tipo': '', 'Cuenta': 'TOTAL GASTOS', 'Saldo': totalGastos });
        balanceData.push({ 'Tipo': '', 'Cuenta': '', 'Saldo': '' });

        // RESULTADO NETO
        balanceData.push({ 'Tipo': 'RESULTADO NETO', 'Cuenta': totalIngresos - totalGastos >= 0 ? 'Beneficio' : 'Pérdida', 'Saldo': totalIngresos - totalGastos });

        return balanceData;
    }
    
    exportToCSV(data, filename) {
        if (data.length === 0) {
            throw new Error('No hay datos para exportar');
        }
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    let value = row[header];
                    // Escapar comillas y envolver en comillas si contiene coma o comilla
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        value = `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(',')
            )
        ].join('\n');
        
        // Crear y descargar archivo
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        this.downloadBlob(blob, `${filename}.csv`);
        
        return {
            success: true,
            filename: `${filename}.csv`,
            records: data.length,
            format: 'CSV'
        };
    }
    
    exportToExcel(data, filename, type = 'generic') {
        if (data.length === 0) {
            throw new Error('No hay datos para exportar');
        }
        
        // Crear libro de trabajo Excel
        const workbook = XLSX.utils.book_new();
        
        // Generar hoja según el tipo de exportación
        let worksheet;
        switch (type) {
            case 'movements':
                worksheet = this.createMovementsWorksheet(data);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos');
                break;
            case 'accounts':
                worksheet = this.createAccountsWorksheet(data);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Cuentas');
                break;
            case 'balance':
                worksheet = this.createBalanceWorksheet(data);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Balance General');
                break;
            default:
                // Exportación genérica como antes pero en XLSX
                worksheet = XLSX.utils.json_to_sheet(data);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos');
        }
        
        // Generar archivo Excel
        const excelBuffer = XLSX.write(workbook, { 
            bookType: 'xlsx', 
            type: 'array',
            cellStyles: true 
        });
        
        // Crear blob y descargar
        const blob = new Blob([excelBuffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        this.downloadBlob(blob, `${filename}.xlsx`);
        
        return {
            success: true,
            filename: `${filename}.xlsx`,
            records: data.length,
            format: 'Excel (.xlsx)'
        };
    }
    
    downloadBlob(blob, filename) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        
        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    // ===== FUNCIONES ESPECIALIZADAS PARA EXCEL =====
    
    createMovementsWorksheet(movements) {
        // Crear hoja con los datos de movimientos
        const worksheet = XLSX.utils.json_to_sheet(movements);
        
        // Agregar fila de totales al final
        const totalImporte = movements.reduce((sum, mov) => sum + (parseFloat(mov.Importe) || 0), 0);
        const totalRow = {
            'Fecha': '',
            'Cuenta': '',
            'Tipo': '',
            'Categoría': 'TOTAL',
            'Descripción': '',
            'Importe': totalImporte,
            'Saldo': ''
        };
        
        XLSX.utils.sheet_add_json(worksheet, [totalRow], { 
            skipHeader: true, 
            origin: -1 
        });
        
        // Configurar anchos de columna
        const columnWidths = [
            { wch: 12 }, // Fecha
            { wch: 25 }, // Cuenta
            { wch: 10 }, // Tipo
            { wch: 15 }, // Categoría
            { wch: 35 }, // Descripción
            { wch: 15 }, // Importe
            { wch: 15 }  // Saldo
        ];
        worksheet['!cols'] = columnWidths;
        
        return worksheet;
    }
    
    createAccountsWorksheet(accounts) {
        const worksheet = XLSX.utils.json_to_sheet(accounts);
        
        // Calcular totales por tipo
        const totalPorTipo = {};
        accounts.forEach(acc => {
            if (!totalPorTipo[acc.Tipo]) {
                totalPorTipo[acc.Tipo] = 0;
            }
            totalPorTipo[acc.Tipo] += parseFloat(acc['Saldo Actual']) || 0;
        });
        
        // Agregar filas de totales
        const totalRows = [];
        totalRows.push({ 'Nombre': '', 'Tipo': '', 'Saldo Inicial': '', 'Saldo Actual': '', 'Descripción': '' });
        totalRows.push({ 'Nombre': 'TOTALES POR TIPO', 'Tipo': '', 'Saldo Inicial': '', 'Saldo Actual': '', 'Descripción': '' });
        
        Object.keys(totalPorTipo).forEach(tipo => {
            totalRows.push({
                'Nombre': '',
                'Tipo': tipo,
                'Saldo Inicial': '',
                'Saldo Actual': totalPorTipo[tipo],
                'Descripción': ''
            });
        });
        
        XLSX.utils.sheet_add_json(worksheet, totalRows, { 
            skipHeader: true, 
            origin: -1 
        });
        
        // Configurar anchos de columna
        const columnWidths = [
            { wch: 25 }, // Nombre
            { wch: 15 }, // Tipo
            { wch: 15 }, // Saldo Inicial
            { wch: 15 }, // Saldo Actual
            { wch: 30 }  // Descripción
        ];
        worksheet['!cols'] = columnWidths;
        
        return worksheet;
    }
    
    createBalanceWorksheet(balanceData) {
        const worksheet = XLSX.utils.json_to_sheet(balanceData);
        
        // Configurar anchos de columna
        const columnWidths = [
            { wch: 15 }, // Tipo
            { wch: 30 }, // Cuenta
            { wch: 15 }  // Saldo
        ];
        worksheet['!cols'] = columnWidths;
        
        return worksheet;
    }
    
    formatDateForExport(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    formatDateForFilename(date) {
        if (!date) {
            return new Date().toISOString().slice(0, 10);
        }
        return date;
    }
    
    getAvailableExportTypes() {
        return [
            { value: 'movements', label: 'Movimientos', description: 'Historial completo de movimientos contables' },
            { value: 'accounts', label: 'Cuentas', description: 'Lista de todas las cuentas con sus saldos' },
            { value: 'balance', label: 'Balance General', description: 'Resumen financiero con totales' }
        ];
    }
    
    getAvailableExportFormats() {
        return [
            { value: 'csv', label: 'CSV', description: 'Archivo separado por comas (compatible con Excel)' },
            { value: 'excel', label: 'Excel', description: 'Archivo de hoja de cálculo' }
        ];
    }
    
    // ===== GESTIÓN INDIVIDUAL DE CUENTAS =====
    
    getAccount(accountId) {
        const accounts = this.getAccounts();
        return accounts.find(acc => acc.id === accountId);
    }
    
    // ===== GESTIÓN INDIVIDUAL DE MOVIMIENTOS =====
    
    getMovement(movementId) {
        return (this._movements || []).find(mov => mov.id === movementId);
    }
    
    async updateMovement(movementId, newData) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) {
            throw new Error('Debes estar autenticado para actualizar movimientos');
        }
        
        const original = this.getMovement(movementId);
        if (!original) return false;
        
        // Validar datos básicos
        if (!newData.tipo || !newData.cantidad || !newData.descripcion || !newData.fecha) {
            throw new Error('Todos los campos son obligatorios');
        }
        
        if (newData.cantidad <= 0) {
            throw new Error('La cantidad debe ser mayor a cero');
        }
        
        // Actualizar datos manteniendo el ID y created_at
        const updated = {
            ...original,
            ...newData,
            id: original.id,
            created_at: original.created_at,
            updated_at: new Date().toISOString(),
            cantidad: parseFloat(newData.cantidad)
        };
        
        // Persistir el movimiento actualizado
        await this.saveMovement(updated);
        
        // Recalcular saldos de todas las cuentas desde cero
        await this.recalcAllBalances();
        
        return true;
    }
    
    async deleteMovement(movementId) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) {
            throw new Error('Debes estar autenticado para eliminar movimientos');
        }
        
        const exists = this.getMovement(movementId);
        if (!exists) return false;
        
        // Borrar de DataClient y de caché
        await DataClient.deleteMovement(currentUser.id, movementId);
        this._movements = (this._movements || []).filter(mov => mov.id !== movementId);
        
        // Recalcular saldos
        await this.recalcAllBalances();
        
        return true;
    }

    // ===== CÁLCULOS DE ESTADÍSTICAS CON FILTROS DE FECHA =====

    /**
     * Calcula estadísticas financieras hasta una fecha específica
     */
    calculateFinancialStatsUpToDate(upToDate) {
        const currentUser = this.auth.currentUser;
        if (!currentUser) return null;

        const accounts = this.getAccounts();
        let movements = this.getMovements();
        
        // Filtrar movimientos hasta la fecha especificada
        movements = movements.filter(mov => mov.fecha <= upToDate);
        
        // Crear copia de las cuentas para calcular balances históricos
        const accountsWithHistoricalBalance = accounts.map(acc => ({
            ...acc,
            saldo_actual: acc.saldo_inicial || 0
        }));
        
        // Aplicar movimientos históricos
        for (const movement of movements) {
            const sourceAccount = accountsWithHistoricalBalance.find(acc => acc.id === movement.cuenta_id);
            const destAccount = accountsWithHistoricalBalance.find(acc => acc.id === movement.cuenta_destino_id);
            
            if (sourceAccount && destAccount) {
                const accountType = this.accountTypes[sourceAccount.tipo];
                const multiplier = accountType ? accountType.sign : 1;
                
                if (movement.tipo === 'ingreso') {
                    destAccount.saldo_actual += movement.cantidad;
                } else if (movement.tipo === 'gasto') {
                    sourceAccount.saldo_actual -= movement.cantidad;
                } else if (movement.tipo === 'transferencia') {
                    sourceAccount.saldo_actual -= movement.cantidad;
                    destAccount.saldo_actual += movement.cantidad;
                }
            }
        }
        
        // Calcular totales con balances históricos
        return this.calculateTotalsFromAccounts(accountsWithHistoricalBalance);
    }

    /**
     * Calcula estado de resultados para un período específico
     */
    calculateIncomeStatementForPeriod(filters) {
        let movements = this.getMovements();
        
        // Aplicar filtros de fecha
        if (filters.dateFrom || filters.dateTo) {
            movements = this.applyDateFiltersToMovements(movements, filters);
        }
        
        // Calcular ingresos y gastos del período
        const ingresosPeriodo = movements
            .filter(mov => mov.tipo === 'ingreso')
            .reduce((sum, mov) => sum + mov.cantidad, 0);
            
        const gastosPeriodo = movements
            .filter(mov => mov.tipo === 'gasto')
            .reduce((sum, mov) => sum + mov.cantidad, 0);
        
        return {
            ingresos_total: ingresosPeriodo,
            gastos_total: gastosPeriodo,
            resultado: ingresosPeriodo - gastosPeriodo
        };
    }

    /**
     * Aplica filtros de fecha a movimientos
     */
    applyDateFiltersToMovements(movements, filters) {
        let filtered = [...movements];
        
        if (filters.dateFrom) {
            filtered = filtered.filter(mov => mov.fecha >= filters.dateFrom);
        }
        
        if (filters.dateTo) {
            filtered = filtered.filter(mov => mov.fecha <= filters.dateTo);
        }
        
        return filtered;
    }

    /**
     * Calcula totales a partir de una lista de cuentas
     */
    calculateTotalsFromAccounts(accounts) {
        const activoAccounts = accounts.filter(acc => acc.tipo === 'activo');
        const pasivoAccounts = accounts.filter(acc => acc.tipo === 'pasivo');
        const patrimonioAccounts = accounts.filter(acc => acc.tipo === 'patrimonio');
        const ingresoAccounts = accounts.filter(acc => acc.tipo === 'ingreso');
        const gastoAccounts = accounts.filter(acc => acc.tipo === 'gasto');

        const activos_total = activoAccounts.reduce((sum, acc) => sum + (acc.saldo_actual || 0), 0);
        const pasivos_total = Math.abs(pasivoAccounts.reduce((sum, acc) => sum + (acc.saldo_actual || 0), 0));
        const patrimonio_total = patrimonioAccounts.reduce((sum, acc) => sum + (acc.saldo_actual || 0), 0);
        const ingresos_total = ingresoAccounts.reduce((sum, acc) => sum + (acc.saldo_actual || 0), 0);
        const gastos_total = gastoAccounts.reduce((sum, acc) => sum + Math.abs(acc.saldo_actual || 0), 0);

        const saldo_total = activos_total - pasivos_total + patrimonio_total;

        return {
            activos_total,
            pasivos_total,
            patrimonio_total,
            ingresos_total,
            gastos_total,
            saldo_total,
            saldo_patrimonial: saldo_total
        };
    }
}

export default AccountingManager;
