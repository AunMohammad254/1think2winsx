'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';

interface DateTimePickerProps {
    id?: string;
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

export default function DateTimePicker({
    id,
    value,
    onChange,
    placeholder = 'Select date and time',
    minYear = new Date().getFullYear(),
    maxYear = new Date().getFullYear() + 5,
    className = '',
}: DateTimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [internalDate, setInternalDate] = useState<string>(value || '');
    const [view, setView] = useState<'days' | 'months' | 'years'>('days');
    const [viewDate, setViewDate] = useState(() => {
        if (value) {
            return new Date(value);
        }
        return new Date();
    });
    
    // Time state
    const [selectedHour, setSelectedHour] = useState(() => {
        if (value) return new Date(value).getHours() % 12 || 12;
        return 12;
    });
    const [selectedMinute, setSelectedMinute] = useState(() => {
        if (value) return new Date(value).getMinutes();
        return 0;
    });
    const [selectedAmPm, setSelectedAmPm] = useState(() => {
        if (value) return new Date(value).getHours() >= 12 ? 'PM' : 'AM';
        return 'PM';
    });

    const [yearRangeStart, setYearRangeStart] = useState(() => {
        const year = viewDate.getFullYear();
        return Math.floor(year / 12) * 12;
    });

    const containerRef = useRef<HTMLDivElement>(null);

    // Sync state when opened
    useEffect(() => {
        if (isOpen) {
            setInternalDate(value || '');
            if (value) {
                const d = new Date(value);
                setSelectedHour(d.getHours() % 12 || 12);
                setSelectedMinute(d.getMinutes());
                setSelectedAmPm(d.getHours() >= 12 ? 'PM' : 'AM');
                setViewDate(new Date(value));
            } else {
                setViewDate(new Date());
            }
        }
    }, [isOpen, value]);

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
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
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

        for (let i = 0; i < firstDay; i++) {
            days.push(null);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            days.push(i);
        }

        return days;
    };

    const getInternalDateString = (day: number, hour: number, minute: number, ampm: string) => {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        let h = hour;
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    };

    const handleSelectDay = (day: number) => {
        setInternalDate(getInternalDateString(day, selectedHour, selectedMinute, selectedAmPm));
    };

    const handleTimeChange = (type: 'hour' | 'minute' | 'ampm', val: any) => {
        let newHour = selectedHour;
        let newMinute = selectedMinute;
        let newAmPm = selectedAmPm;

        if (type === 'hour') { newHour = val; setSelectedHour(val); }
        if (type === 'minute') { newMinute = val; setSelectedMinute(val); }
        if (type === 'ampm') { newAmPm = val; setSelectedAmPm(val); }

        if (internalDate) {
            const d = new Date(internalDate);
            setInternalDate(getInternalDateString(d.getDate(), newHour, newMinute, newAmPm));
        }
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

    const navigateMonth = (direction: number) => {
        const newDate = new Date(viewDate);
        newDate.setMonth(newDate.getMonth() + direction);
        setViewDate(newDate);
    };

    const navigateYearRange = (direction: number) => {
        setYearRangeStart((prev) => prev + direction * 12);
    };

    const isSelected = (day: number) => {
        if (!internalDate) return false;
        const selectedDate = new Date(internalDate);
        return (
            selectedDate.getDate() === day &&
            selectedDate.getMonth() === viewDate.getMonth() &&
            selectedDate.getFullYear() === viewDate.getFullYear()
        );
    };

    const isToday = (day: number) => {
        const today = new Date();
        return (
            today.getDate() === day &&
            today.getMonth() === viewDate.getMonth() &&
            today.getFullYear() === viewDate.getFullYear()
        );
    };

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
                className="w-full pl-12 pr-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-left text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-all duration-200"
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
                                        <div className="grid grid-cols-7 gap-1 mb-2">
                                            {DAYS.map((day) => (
                                                <div key={day} className="text-center text-xs font-medium text-slate-500 py-2">
                                                    {day}
                                                </div>
                                            ))}
                                        </div>

                                        <div className="grid grid-cols-7 gap-1">
                                            {generateCalendarDays().map((day, index) => (
                                                <div key={index} className="aspect-square">
                                                    {day !== null && (
                                                        <button
                                                            type="button"
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
                                                        </button>
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
                                            <button
                                                key={month}
                                                type="button"
                                                onClick={() => handleSelectMonth(index)}
                                                className={`py-3 px-2 rounded-lg text-sm font-medium transition-all duration-200
                          ${viewDate.getMonth() === index
                                                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                                                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                                    }`}
                                            >
                                                {month.slice(0, 3)}
                                            </button>
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
                                            <button
                                                key={year}
                                                type="button"
                                                onClick={() => handleSelectYear(year)}
                                                className={`py-3 px-2 rounded-lg text-sm font-medium transition-all duration-200
                          ${viewDate.getFullYear() === year
                                                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                                                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                                    }`}
                                            >
                                                {year}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Time Picker */}
                        {view === 'days' && (
                            <div className="px-4 pb-4 flex items-center justify-center gap-2">
                                <select 
                                    value={selectedHour} 
                                    onChange={(e) => handleTimeChange('hour', parseInt(e.target.value))}
                                    className="bg-gray-800 border border-white/10 rounded-lg text-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                                >
                                    {[...Array(12)].map((_, i) => (
                                        <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                                    ))}
                                </select>
                                <span className="text-white font-medium">:</span>
                                <select 
                                    value={selectedMinute} 
                                    onChange={(e) => handleTimeChange('minute', parseInt(e.target.value))}
                                    className="bg-gray-800 border border-white/10 rounded-lg text-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                                >
                                    {[...Array(60)].map((_, m) => (
                                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                                    ))}
                                </select>
                                <div className="flex bg-gray-800 rounded-lg overflow-hidden border border-white/10 ml-2">
                                    <button 
                                        type="button" 
                                        onClick={() => handleTimeChange('ampm', 'AM')}
                                        className={`px-3 py-1.5 text-sm font-medium transition-colors ${selectedAmPm === 'AM' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                    >AM</button>
                                    <button 
                                        type="button" 
                                        onClick={() => handleTimeChange('ampm', 'PM')}
                                        className={`px-3 py-1.5 text-sm font-medium transition-colors ${selectedAmPm === 'PM' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                    >PM</button>
                                </div>
                            </div>
                        )}

                        {/* Footer with clear/today/confirm buttons */}
                        <div className="p-3 border-t border-white/10 flex items-center justify-between bg-white/5">
                            <button
                                type="button"
                                onClick={() => {
                                    setInternalDate('');
                                    onChange('');
                                    setIsOpen(false);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            >
                                <X className="w-4 h-4" />
                                Clear
                            </button>
                            
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setView('days');
                                        setViewDate(new Date());
                                    }}
                                    className="px-3 py-1.5 text-sm font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-all"
                                >
                                    Today
                                </button>
                                <button
                                    type="button"
                                    disabled={!internalDate}
                                    onClick={() => {
                                        if (internalDate) {
                                            onChange(internalDate);
                                            setIsOpen(false);
                                        }
                                    }}
                                    className="px-4 py-1.5 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/25"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
