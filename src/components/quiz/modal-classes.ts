/**
 * Class names shared by the quiz access modals (PaymentModal, ConfirmationModal, InsufficientBalanceModal).
 * Each modal adds its own accent gradient to the icon badge and the primary button.
 */
export const MODAL_BACKDROP_CLASS = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
export const MODAL_PANEL_CLASS = 'relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8';
export const MODAL_CLOSE_BUTTON_CLASS = 'absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors';
export const MODAL_ICON_BADGE_CLASS = 'w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br flex items-center justify-center';
export const MODAL_SECONDARY_BUTTON_CLASS = 'flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors';
export const MODAL_PRIMARY_BUTTON_CLASS = 'flex-1 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r transition-all';
export const MODAL_SPINNER_CLASS = 'w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin';
