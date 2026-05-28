'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
    Target, Link2, LifeBuoy, Phone, Mail,
    ExternalLink, MessageCircle, Camera, Send, Bell,
    ChevronRight, Heart
} from 'lucide-react';

const staggerCol = (delay: number) => ({
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, delay } }
});

const quickLinks = [
    { href: '/', label: 'Home' },
    { href: '/quizzes', label: 'Quizzes' },
    { href: '/prizes', label: 'Prizes' },
    { href: '/leaderboard', label: 'Leaderboard' }
];

const supportLinks = [
    { href: '/faq', label: 'FAQ' },
    { href: '/contact', label: 'Contact Us' },
    { href: '/disclaimer', label: 'Disclaimer' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/privacy', label: 'Privacy Policy' }
];

const socialLinks = [
    { name: 'Facebook', icon: ExternalLink, color: 'hover:text-blue-400' },
    { name: 'Twitter', icon: MessageCircle, color: 'hover:text-sky-400' },
    { name: 'Instagram', icon: Camera, color: 'hover:text-pink-400' }
];

export default function Footer() {
    return (
        <div className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-blue-900/60 to-transparent"></div>
            <div className="absolute top-0 left-0 w-full h-full hidden md:block">
                <div className="absolute top-0 left-1/4 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl md:animate-pulse"></div>
                <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl md:animate-pulse" style={{ animationDelay: '1s' }}></div>
                <div className="absolute top-1/2 left-1/2 w-24 h-24 bg-blue-400/10 rounded-full blur-2xl hidden lg:block lg:animate-bounce" style={{ animationDuration: '4s' }}></div>
            </div>

            <footer className="relative bg-gray-900/80 md:backdrop-blur-xl md:bg-gradient-to-t md:from-gray-900/80 md:via-blue-900/40 md:to-gray-900/60 border-t border-white/10 shadow-lg md:shadow-2xl">
                <div className="container mx-auto px-4 py-12">

                    {/* Main Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">

                        {/* Company Info */}
                        <motion.div variants={staggerCol(0)} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                            <div className="group">
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="relative">
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full opacity-0 md:group-hover:opacity-50 transition-opacity duration-300 md:blur-lg"></div>
                                        <div className="relative bg-gradient-to-r from-blue-600 to-purple-700 p-3 rounded-full border border-white/20 shadow-md md:shadow-lg">
                                            <Target className="w-6 h-6 text-white" />
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent">
                                            1Think 2Win
                                        </h3>
                                        <p className="text-xs text-gray-400">Think Smart, Win Big</p>
                                    </div>
                                </div>
                                <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                                    <p className="text-gray-300 text-sm leading-relaxed">
                                        Test your cricket knowledge and win amazing prizes in our innovative quiz competition.
                                        Join thousands of smart thinkers in this exciting journey of knowledge and rewards!
                                    </p>
                                </div>
                            </div>
                        </motion.div>

                        {/* Quick Links */}
                        <motion.div variants={staggerCol(0.1)} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                            <h4 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                                <Link2 className="w-5 h-5 text-blue-400" />
                                <span>Quick Links</span>
                            </h4>
                            <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                                <ul className="space-y-3">
                                    {quickLinks.map((item) => (
                                        <li key={item.href}>
                                            <Link
                                                href={item.href}
                                                className="group/link flex items-center gap-3 text-gray-300 hover:text-white transition-colors duration-200 p-2 rounded-md hover:bg-white/10"
                                            >
                                                <span className="text-sm font-medium">{item.label}</span>
                                                <ChevronRight className="w-3.5 h-3.5 ml-auto text-blue-400 opacity-0 group-hover/link:opacity-100 transition-all duration-200 group-hover/link:translate-x-1" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </motion.div>

                        {/* Support */}
                        <motion.div variants={staggerCol(0.2)} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                            <h4 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                                <LifeBuoy className="w-5 h-5 text-green-400" />
                                <span>Support</span>
                            </h4>
                            <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                                <ul className="space-y-3">
                                    {supportLinks.map((item) => (
                                        <li key={item.href}>
                                            <Link
                                                href={item.href}
                                                className="group/link flex items-center gap-3 text-gray-300 hover:text-white transition-colors duration-200 p-2 rounded-md hover:bg-white/10"
                                            >
                                                <span className="text-sm font-medium">{item.label}</span>
                                                <ChevronRight className="w-3.5 h-3.5 ml-auto text-green-400 opacity-0 group-hover/link:opacity-100 transition-all duration-200 group-hover/link:translate-x-1" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </motion.div>

                        {/* Contact */}
                        <motion.div variants={staggerCol(0.3)} initial="hidden" whileInView="visible" viewport={{ once: true }}>
                            <h4 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                                <Phone className="w-5 h-5 text-purple-400" />
                                <span>Contact</span>
                            </h4>
                            <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4 space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-start gap-3 p-2 rounded-md hover:bg-white/5 transition-colors duration-200">
                                        <Mail className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-400">Email</p>
                                            <p className="text-sm text-white font-medium break-all">support@1think2win.com</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3 p-2 rounded-md hover:bg-white/5 transition-colors duration-200">
                                        <Phone className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-400">Phone</p>
                                            <p className="text-sm text-white font-medium">+92 XXX XXXXXXX</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Social Links */}
                                <div className="border-t border-white/10 pt-4">
                                    <p className="text-xs text-gray-400 mb-3">Follow Us</p>
                                    <div className="flex gap-3">
                                        {socialLinks.map((social) => (
                                            <motion.a
                                                key={social.name}
                                                href="#"
                                                className={`group p-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 ${social.color} transition-colors duration-200 hover:bg-white/10 hover:border-white/20`}
                                                title={social.name}
                                                whileHover={{ scale: 1.15, y: -2 }}
                                                whileTap={{ scale: 0.95 }}
                                                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                            >
                                                <social.icon className="w-5 h-5" />
                                            </motion.a>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>

                    {/* Newsletter */}
                    <motion.div
                        className="mb-8"
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                    >
                        <div className="bg-blue-500/10 md:backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 text-center">
                            <h3 className="text-xl font-bold text-white mb-2 flex items-center justify-center gap-2">
                                <Bell className="w-5 h-5 text-blue-400" />
                                <span>Stay Updated</span>
                            </h3>
                            <p className="text-gray-300 text-sm mb-4">
                                Get the latest quiz updates, cricket news, and exclusive prizes delivered to your inbox!
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                                <input
                                    suppressHydrationWarning
                                    type="email"
                                    placeholder="Enter your email"
                                    className="flex-1 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all duration-200"
                                />
                                <motion.button
                                    className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg shadow-md md:shadow-lg border border-white/20 flex items-center justify-center gap-2"
                                    whileHover={{ scale: 1.03, boxShadow: '0 0 20px rgba(59,130,246,0.4)' }}
                                    whileTap={{ scale: 0.97 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                                >
                                    <Send className="w-4 h-4" />
                                    Subscribe
                                </motion.button>
                            </div>
                        </div>
                    </motion.div>

                    {/* Bottom Bar */}
                    <motion.div
                        className="border-t border-white/10 pt-8"
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 0.6 }}
                    >
                        <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-6">
                            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                                <div className="text-center md:text-left">
                                    <p className="text-gray-300 text-sm">
                                        &copy; 2024 <span className="font-semibold text-white">1Think 2Win</span>. All rights reserved.
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1 flex items-center justify-center md:justify-start gap-1">
                                        Crafted with <Heart className="w-3 h-3 text-red-400 fill-red-400" /> for cricket enthusiasts worldwide
                                    </p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <motion.div
                                        className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/20 border border-green-400/30"
                                        whileHover={{ scale: 1.05 }}
                                        transition={{ type: "spring", stiffness: 400 }}
                                    >
                                        <motion.div
                                            className="w-2 h-2 bg-green-400 rounded-full"
                                            animate={{ opacity: [1, 0.3, 1] }}
                                            transition={{ duration: 2, repeat: Infinity }}
                                        />
                                        <span className="text-green-400 text-xs font-medium">Live</span>
                                    </motion.div>
                                    <div className="text-xs text-gray-400">
                                        Made with <Heart className="w-3 h-3 text-red-400 fill-red-400 inline-block animate-pulse" /> by Antilights
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </footer>
        </div>
    );
}
