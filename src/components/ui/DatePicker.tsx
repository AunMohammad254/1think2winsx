'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';

interface DatePickerProps {
    id: string;
    value?: string;
    onChange: (date: string) => void;
    placeholder?: string;
    minYear?: number;
    maxYear?: number;
    className?: string;
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function DatePicker({
    id,
    value,
    onChange,
    placeholder = 'Select date',
    minYear = 1924,
    maxYear = new Date().getFullYear() - 13, // Default: must be at least 13 years old
    className = '',
}: DatePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [view, setView] = useState<'days' | 'months' | 'years'>('days');
    const [viewDate, setViewDate] = useState(() => {
        if (value) {
            return new Date(value);
        }
        // Default to 18 years ago for DOB picker
        const defaultDate = new Date();
        defaultDate.setFullYear(defaultDate.getFullYear() - 18);
        return defaultDate;
    });
    const [yearRangeStart, setYearRangeStart] = useState(() => {
        const year = viewDate.getFullYear();
        return Math.floor(year / 12) * 12;
    });

    const containerRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setView('days');
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Format display date
    const formatDisplayDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    // Get days in month
    const getDaysInMonth = (year: number, month: number) => {
        return new Date(year, month + 1, 0).getDate();
    };

    // Get first day of month (0 = Sunday)
    const getFirstDayOfMonth = (year: number, month: number) => {
        return new Date(year, month, 1).getDay();
    };

    // Generate calendar days
    const generateCalendarDays = () => {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        const daysInMonth = getDaysInMonth(year, month);
        const firstDay = getFirstDayOfMonth(year, month);
        const days: (number | null)[] = [];

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) {
            days.push(null);
        }

        // Days of the month
        for (let i = 1; i <= daysInMonth; i++) {
            days.push(i);
        }

        return days;
    };

    // Handle day selection
    const handleSelectDay = (day: number) => {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        onChange(dateStr);
        setIsOpen(false);
        setView('days');
    };

    // Handle month selection
    const handleSelectMonth = (monthIndex: number) => {
        const newDate = new Date(viewDate);
        newDate.setMonth(monthIndex);
        setViewDate(newDate);
        setView('days');
    };

    // Handle year selection
    const handleSelectYear = (year: number) => {
        const newDate = new Date(viewDate);
        newDate.setFullYear(year);
        setViewDate(newDate);
        setView('months');
    };

    // Navigate months
    const navigateMonth = (direction: number) => {
        const newDate = new Date(viewDate);
        newDate.setMonth(newDate.getMonth() + direction);
        setViewDate(newDate);
    };

    // Navigate year range
    const navigateYearRange = (direction: number) => {
        setYearRangeStart((prev) => prev + direction * 12);
    };

    // Check if day is selected
    const isSelected = (day: number) => {
        if (!value) return false;
        const selectedDate = new Date(value);
        return (
            selectedDate.getDate() === day &&
            selectedDate.getMonth() === viewDate.getMonth() &&
            selectedDate.getFullYear() === viewDate.getFullYear()
        );
    };

    // Check if day is today
    const isToday = (day: number) => {
        const today = new Date();
        return (
            today.getDate() === day &&
            today.getMonth() === viewDate.getMonth() &&
            today.getFullYear() === viewDate.getFullYear()
        );
    };

    // Generate years for selection
    const generateYears = () => {
        const years: number[] = [];
        for (let i = yearRangeStart; i < yearRangeStart + 12; i++) {
            if (i >= minYear && i <= maxYear) {
                years.push(i);
            }
        }
        return years;
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {/* Input Field */}
            <button
                type="button"
                id={id}
                onClick={() => setIsOpen(!isOpen)}
                className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-left text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 hover:bg-white/10"
            >
                {value ? (
                    <span className="text-white">{formatDisplayDate(value)}</span>
                ) : (
                    <span className="text-slate-500">{placeholder}</span>
                )}
            </button>
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />

            {/* Dropdown Calendar */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="absolute z-50 mt-2 w-full sm:w-80 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-white/10 bg-gradient-to-r from-purple-600/20 to-blue-600/20">
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => (view === 'years' ? navigateYearRange(-1) : navigateMonth(-1))}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-300 hover:text-white"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>

                                <div className="flex items-center gap-1">
                                    {view === 'days' && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setView('months')}
                                                className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-white font-semibold"
                                            >
                                                {MONTHS[viewDate.getMonth()]}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setYearRangeStart(Math.floor(viewDate.getFullYear() / 12) * 12);
                                                    setView('years');
                                                }}
                                                className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-white font-semibold"
                                            >
                                                {viewDate.getFullYear()}
                                            </button>
                                        </>
                                    )}
                                    {view === 'months' && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setYearRangeStart(Math.floor(viewDate.getFullYear() / 12) * 12);
                                                setView('years');
                                            }}
                                            className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-white font-semibold"
                                        >
                                            {viewDate.getFullYear()}
                                        </button>
                                    )}
                                    {view === 'years' && (
                                        <span className="px-3 py-1.5 text-white font-semibold">
                                            {yearRangeStart} - {Math.min(yearRangeStart + 11, maxYear)}
                                        </span>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => (view === 'years' ? navigateYearRange(1) : navigateMonth(1))}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-300 hover:text-white"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Calendar Body */}
                        <div className="p-4">
                            <AnimatePresence mode="wait">
                                {/* Days View */}
                                {view === 'days' && (
                                    <motion.div
                                        key="days"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        {/* Day headers */}
                                        <div className="grid grid-cols-7 gap-1 mb-2">
                                            {DAYS.map((day) => (
                                                <div
                                                    key={day}
                                                    className="text-center text-xs font-medium text-slate-500 py-2"
                                                >
                                                    {day}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Days grid */}
                                        <div className="grid grid-cols-7 gap-1">
                                            {generateCalendarDays().map((day, index) => (
                                                <div key={index} className="aspect-square">
                                                    {day !== null && (
                                                        <motion.button
                                                            type="button"
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.95 }}
                                                            onClick={() => handleSelectDay(day)}
                                                            className={`w-full h-full rounded-lg flex items-center justify-center text-sm font-medium transition-all duration-200
                                ${isSelected(day)
                                                                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                                                                    : isToday(day)
                                                                        ? 'bg-white/10 text-purple-400 ring-1 ring-purple-500/50'
                                                                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                                                }`}
                                                        >
                                                            {day}
                                                        </motion.button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}

                                {/* Months View */}
                                {view === 'months' && (
                                    <motion.div
                                        key="months"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={{ duration: 0.15 }}
                                        className="grid grid-cols-3 gap-2"
                                    >
                                        {MONTHS.map((month, index) => (
                                            <motion.button
                                                key={month}
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleSelectMonth(index)}
                                                className={`py-3 px-2 rounded-lg text-sm font-medium transition-all duration-200
                          ${viewDate.getMonth() === index
                                                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                                                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                                    }`}
                                            >
                                                {month.slice(0, 3)}
                                            </motion.button>
                                        ))}
                                    </motion.div>
                                )}

                                {/* Years View */}
                                {view === 'years' && (
                                    <motion.div
                                        key="years"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={{ duration: 0.15 }}
                                        className="grid grid-cols-3 gap-2"
                                    >
                                        {generateYears().map((year) => (
                                            <motion.button
                                                key={year}
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleSelectYear(year)}
                                                className={`py-3 px-2 rounded-lg text-sm font-medium transition-all duration-200
                          ${viewDate.getFullYear() === year
                                                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                                                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                                    }`}
                                            >
                                                {year}
                                            </motion.button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Footer with clear/today buttons */}
                        <div className="p-3 border-t border-white/10 flex justify-between">
                            {value && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange('');
                                        setIsOpen(false);
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                    Clear
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setView('days');
                                    const today = new Date();
                                    today.setFullYear(today.getFullYear() - 18);
                                    setViewDate(today);
                                }}
                                className="ml-auto px-3 py-1.5 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                Jump to 2007
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
