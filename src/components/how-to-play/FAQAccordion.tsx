'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface FAQItem {
    question: string;
    answer: string;
}

const faqs: FAQItem[] = [
    {
        question: "Can I participate in the same quiz multiple times?",
        answer: "No, each user is allowed only one attempt per quiz to ensure fairness for all participants. This rule helps maintain the integrity of the competition and gives everyone an equal chance to win."
    },
    {
        question: "What happens if I lose internet connection during a quiz?",
        answer: "Don't worry! Your progress is automatically saved every time you answer a question. If you lose connection, simply reconnect and continue from where you left off - as long as the quiz is still active and within the time limit."
    },
    {
        question: "How long do I have to claim my prize?",
        answer: "Winners have 14 days from the notification date to provide their shipping details. After this period, you may forfeit your prize. We'll send reminder emails to help you claim on time!"
    },
    {
        question: "Can I get a refund if I don't win?",
        answer: "Entry fees are non-refundable once you start a quiz, as stated in our terms and conditions. The 2 PKR fee is used to fund prizes and maintain the platform. Think of it as your ticket to the prize draw!"
    },
    {
        question: "How are winners selected?",
        answer: "Winners are randomly selected from all participants who successfully completed the quiz. Every completed entry has an equal chance of winning, regardless of the score achieved. It's all about participation!"
    },
    {
        question: "When and how will I receive my prize?",
        answer: "After providing your shipping details, prizes are typically delivered within 14 business days. You'll receive tracking information via email, and large prizes like the CD 70 Bike include special delivery arrangements."
    },
];

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

export default function FAQAccordion() {
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
