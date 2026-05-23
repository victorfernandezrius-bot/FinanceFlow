// Configuración de planes y límites del SaaS
const PLAN_LIMITS = {
    free: {
        name: 'Plan Gratuito',
        price: 0,
        features: {
            cuentas_bancarias: 1,
            cuentas_ingresos: 2,
            cuentas_gastos: 8,
            conexion_bancaria: false,
            automatizacion: false,
            plan_autocontrol: false,
            notificaciones_push: false,
            libro_diario: true,
            libro_mayor_mensual: true,
            libro_mayor_anual: false,
            exportacion_datos: false,
            soporte_prioritario: false
        },
        description: 'Gestión manual perfecta para empezar',
        benefits: [
            'Dashboard con gráficos básicos',
            'Registro manual de movimientos',
            '1 cuenta bancaria (manual)',
            'Hasta 2 cuentas de ingresos',
            'Hasta 8 cuentas de gastos',
            'Libro diario y mayor mensual'
        ]
    },
    premium: {
        name: 'Plan Premium',
        price_monthly: 2,
        price_yearly: 20,
        stripe_price_id_monthly: 'price_monthly_premium',
        stripe_price_id_yearly: 'price_yearly_premium',
        features: {
            cuentas_bancarias: 1,
            cuentas_ingresos: 6,
            cuentas_gastos: 15,
            conexion_bancaria: true,
            automatizacion: true,
            plan_autocontrol: true,
            notificaciones_push: true,
            libro_diario: true,
            libro_mayor_mensual: true,
            libro_mayor_anual: true,
            exportacion_datos: true,
            soporte_prioritario: true
        },
        description: 'Automatización completa para usuarios avanzados',
        benefits: [
            'Todo lo incluido en Plan Gratuito',
            'Conexión bancaria automática',
            'Importación automática de movimientos',
            'Reglas de asignación automática',
            'Hasta 6 cuentas de ingresos',
            'Hasta 15 cuentas de gastos',
            'Libros contables completos (anual)',
            'Plan de autocontrol con presupuestos',
            'Notificaciones push en tiempo real',
            'Exportación de datos (Excel/PDF)',
            'Soporte prioritario'
        ]
    }
};

// Configuración de Stripe
const STRIPE_CONFIG = {
    success_url: window.location.origin + '/dashboard?upgrade=success',
    cancel_url: window.location.origin + '/pricing?upgrade=cancelled'
};

// Mensajes para límites alcanzados
const LIMIT_MESSAGES = {
    cuentas_ingresos: {
        title: '¡Límite de cuentas de ingresos alcanzado!',
        message: 'Has alcanzado el límite de {limit} cuentas de ingresos del Plan Gratuito.',
        premium_benefit: 'Con el Plan Premium puedes crear hasta 6 cuentas de ingresos.'
    },
    cuentas_gastos: {
        title: '¡Límite de cuentas de gastos alcanzado!',
        message: 'Has alcanzado el límite de {limit} cuentas de gastos del Plan Gratuito.',
        premium_benefit: 'Con el Plan Premium puedes crear hasta 15 cuentas de gastos.'
    },
    conexion_bancaria: {
        title: '¡Función Premium requerida!',
        message: 'La conexión bancaria automática está disponible solo en el Plan Premium.',
        premium_benefit: 'Conecta tu banco y automatiza la importación de movimientos.'
    },
    plan_autocontrol: {
        title: '¡Plan de Autocontrol Premium!',
        message: 'El plan de autocontrol con presupuestos está disponible solo en el Plan Premium.',
        premium_benefit: 'Crea presupuestos por categoría y recibe alertas automáticas.'
    },
    libro_anual: {
        title: '¡Libro Mayor Anual Premium!',
        message: 'El libro mayor anual está disponible solo en el Plan Premium.',
        premium_benefit: 'Accede a reportes anuales completos y análisis avanzados.'
    },
    notificaciones: {
        title: '¡Notificaciones Push Premium!',
        message: 'Las notificaciones push están disponibles solo en el Plan Premium.',
        premium_benefit: 'Recibe alertas instantáneas de nuevos movimientos y presupuestos.'
    }
};

export { PLAN_LIMITS, STRIPE_CONFIG, LIMIT_MESSAGES };