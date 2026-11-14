'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle } from 'lucide-react';
import type { Faq } from '@/lib/how-to-play-content';

type FAQItem = Faq;

interface AccordionItemProps {
    faq: FAQItem;
    isOpen: boolean;
    onToggle: () => void;
    index: number;
}

function AccordionItem({ faq, isOpen, onToggle, index }: AccordionItemProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.4, delay: index * 0.1 }}
            className="group"
        >
            <div className={`overflow-hidden rounded-xl border transition-all duration-300 ${isOpen
                    ? 'bg-gradient-to-br from-emerald-900/30 to-slate-800/80 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                    : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600/50 hover:bg-slate-800/60'
                }`}>
                {/* Question Header */}
                <button
                    onClick={onToggle}
                    className="w-full px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4 text-left"
                >
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className={`flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors duration-300 ${isOpen
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-slate-700/50 text-gray-400 group-hover:text-emerald-400'
                            }`}>
                            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <h3 className={`text-sm sm:text-base font-semibold transition-colors duration-300 font-[family-name:var(--font-poppins)] ${isOpen ? 'text-white' : 'text-gray-200 group-hover:text-white'
                            }`}>
                            {faq.question}
                        </h3>
                    </div>

                    <motion.div
                        animate={{ rotate: isOpen ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 ${isOpen
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-slate-700/50 text-gray-400 group-hover:bg-slate-600/50'
                            }`}
                    >
                        <ChevronDown className="w-5 h-5" />
                    </motion.div>
                </button>

                {/* Answer Content */}
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-0">
                                <div className="pl-11 sm:pl-14">
                                    <p className="text-gray-400 text-sm sm:text-base leading-relaxed">
                                        {faq.answer}
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

export default function FAQAccordion({ faqs }: { faqs: Faq[] }) {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const handleToggle = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <div className="space-y-3 sm:space-y-4">
            {faqs.map((faq, index) => (
                <AccordionItem
                    key={index}
                    faq={faq}
                    isOpen={openIndex === index}
                    onToggle={() => handleToggle(index)}
                    index={index}
                />
            ))}
        </div>
    );
}
