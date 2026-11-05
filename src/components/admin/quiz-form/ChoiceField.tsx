'use client';

import { Controller, type Control } from 'react-hook-form';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';
import type { ChoiceOption } from './constants';

interface ChoiceFieldProps {
    name: 'difficulty' | 'status';
    label: string;
    options: ChoiceOption[];
    control: Control<QuizFormData>;
    /** Classes of the wrapper around the buttons */
    groupClassName: string;
    /** Classes every button has; the selected one adds its option's colour */
    buttonClassName: string;
}

/** A labelled row of buttons that picks one value (difficulty, status). */
export default function ChoiceField({ name, label, options, control, groupClassName, buttonClassName }: ChoiceFieldProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
                {label}
            </label>
            <Controller
                name={name}
                control={control}
                render={({ field }) => (
                    <div className={groupClassName}>
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => field.onChange(option.value)}
                                className={`${buttonClassName} ${field.value === option.value
                                    ? option.color
                                    : 'bg-gray-800/50 text-gray-400 border-white/5 hover:border-white/10'
                                    }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}
            />
        </div>
    );
}
