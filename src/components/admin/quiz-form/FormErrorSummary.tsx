import type { FieldErrors } from 'react-hook-form';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';

interface FormErrorSummaryProps {
    errors: FieldErrors<QuizFormData>;
}

/** Lists every field that stops the quiz from saving; renders nothing while the form is valid. */
export default function FormErrorSummary({ errors }: FormErrorSummaryProps) {
    if (Object.keys(errors).length === 0) return null;

    return (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 rounded-xl">
            <h3 className="text-red-400 font-semibold mb-2">Please fix the following errors to save:</h3>
            <ul className="list-disc list-inside text-sm text-red-300">
                {Object.entries(errors).map(([key, error]: any) => (
                    <li key={key}>
                        {key}: {error.message || 'Errors in list' /* only the questions array has no message of its own */}
                    </li>
                ))}
            </ul>
        </div>
    );
}
