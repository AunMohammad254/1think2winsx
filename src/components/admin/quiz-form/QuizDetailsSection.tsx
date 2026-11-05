'use client';

import {
    Controller,
    type Control,
    type FieldErrors,
    type UseFormRegister,
    type UseFormSetValue,
    type UseFormWatch,
} from 'react-hook-form';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';
import { MAX_ENTRIES_LIMIT, MAX_POINTS_POOL } from '@/lib/quiz-entries';
import DateTimePicker from '@/components/ui/DateTimePicker';
import ChoiceField from './ChoiceField';
import FieldError from './FieldError';
import QuizTypeToggle from './QuizTypeToggle';
import { difficultyOptions, isTimedStatus, statusOptions } from './constants';

interface QuizDetailsSectionProps {
    control: Control<QuizFormData>;
    register: UseFormRegister<QuizFormData>;
    watch: UseFormWatch<QuizFormData>;
    setValue: UseFormSetValue<QuizFormData>;
    errors: FieldErrors<QuizFormData>;
    walletEnabled: boolean;
    watchedStatus: QuizFormData['status'];
}

/** The "Quiz Details" card: type, title, timings, limits, price, difficulty, status and schedule. */
export default function QuizDetailsSection({
    control,
    register,
    watch,
    setValue,
    errors,
    walletEnabled,
    watchedStatus,
}: QuizDetailsSectionProps) {
    return (
        <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 relative z-50">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Quiz Details</h2>

                <QuizTypeToggle control={control} watch={watch} setValue={setValue} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Title */}
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Quiz Title <span className="text-red-400">*</span>
                    </label>
                    <input
                        {...register('title')}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                        placeholder="Enter quiz title"
                    />
                    <FieldError error={errors.title} />
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Description
                    </label>
                    <textarea
                        {...register('description')}
                        rows={3}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all resize-none"
                        placeholder="Enter quiz description (optional)"
                    />
                </div>

                {/* Duration */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Duration (minutes) <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="number"
                        {...register('duration', { valueAsNumber: true })}
                        min={1}
                        max={180}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                    />
                    <FieldError error={errors.duration} />
                </div>

                {/* Time-Up Display Duration */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        "Time-up" Display Duration (minutes) <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="number"
                        {...register('timeUpDuration', { valueAsNumber: true })}
                        min={1}
                        max={1440}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                    />
                    <FieldError error={errors.timeUpDuration} />
                </div>

                {/* Passing Score */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Passing Score (%) <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="number"
                        {...register('passingScore', { valueAsNumber: true })}
                        min={0}
                        max={100}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                    />
                    <FieldError error={errors.passingScore} />
                </div>

                {/* Entry limit (admin-only) */}
                <div>
                    <label htmlFor="quiz-max-entries" className="block text-sm font-medium text-gray-300 mb-2">
                        Entry Limit (players) <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="quiz-max-entries"
                        type="number"
                        {...register('maxEntries', { valueAsNumber: true })}
                        min={1}
                        max={MAX_ENTRIES_LIMIT}
                        step={1}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                    />
                    <p className="mt-1 text-xs text-gray-500">The first players to lock in an answer get in; later players are told entries have closed. Players never see this number.</p>
                    <FieldError error={errors.maxEntries} />
                </div>

                {/* Points pool (admin-only) */}
                <div>
                    <label htmlFor="quiz-points-pool" className="block text-sm font-medium text-gray-300 mb-2">
                        Points Pool
                    </label>
                    <input
                        id="quiz-points-pool"
                        type="number"
                        {...register('pointsPool', { valueAsNumber: true })}
                        min={0}
                        max={MAX_POINTS_POOL}
                        step={1}
                        className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                    />
                    <p className="mt-1 text-xs text-gray-500">When you settle the quiz, choose a percentage of the players who got in: the earliest of them who scored share this whole pool in random amounts.</p>
                    <FieldError error={errors.pointsPool} />
                </div>

                {/* Access Price */}
                <div className={walletEnabled ? 'block' : 'hidden'}>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Access Price (PKR) <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            {...register('accessPrice', { valueAsNumber: true })}
                            min={0}
                            max={1000}
                            step={0.5}
                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                            placeholder="2"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">PKR</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Price users pay for 24-hour quiz access</p>
                    <FieldError error={errors.accessPrice} />
                </div>

                <ChoiceField
                    name="difficulty"
                    label="Difficulty"
                    options={difficultyOptions}
                    control={control}
                    groupClassName="flex gap-2"
                    buttonClassName="flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all"
                />

                <ChoiceField
                    name="status"
                    label="Status"
                    options={statusOptions}
                    control={control}
                    groupClassName="grid grid-cols-2 sm:grid-cols-5 gap-2"
                    buttonClassName="py-2 px-3 rounded-lg text-sm font-medium border transition-all"
                />

                {/* Schedule Date-Time Picker */}
                {isTimedStatus(watchedStatus) && (
                    <div className="md:col-span-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200 relative z-50">
                        <label className="block text-sm font-medium text-gray-300">
                            Publish Schedule Date & Time <span className="text-red-400">*</span>
                        </label>
                        <Controller
                            name="startsAt"
                            control={control}
                            render={({ field }) => (
                                <DateTimePicker
                                    id="startsAt"
                                    value={field.value || ''}
                                    onChange={field.onChange}
                                    placeholder="Select date and time"
                                    className="w-full"
                                />
                            )}
                        />
                        {errors.startsAt && (
                            <p className="text-xs text-red-400">{errors.startsAt.message}</p>
                        )}
                        <p className="text-xs text-gray-500">Select when this quiz should automatically go live and notify users.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
