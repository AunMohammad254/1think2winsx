import { Save, Loader2 } from 'lucide-react';

interface FormActionsProps {
    isDirty: boolean;
    isEditing: boolean;
    isSubmitting: boolean;
    onCancel?: () => void;
}

/** Footer of the quiz form: the unsaved-changes note, Cancel and the Create/Update button. */
export default function FormActions({ isDirty, isEditing, isSubmitting, onCancel }: FormActionsProps) {
    return (
        <div className="flex items-center justify-between pt-6 border-t border-white/10">
            <div className="text-sm text-gray-400">
                {isDirty && 'You have unsaved changes'}
            </div>
            <div className="flex gap-3">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-6 py-3 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {isEditing ? 'Updating...' : 'Creating...'}
                        </>
                    ) : (
                        <>
                            <Save className="w-5 h-5" />
                            {isEditing ? 'Update Quiz' : 'Create Quiz'}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
