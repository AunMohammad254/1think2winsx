import LazySection from '@/components/LazySection';
import HeroSection from '@/components/HeroSection';
import Link from "next/link";
import { StepCard, PrizeCard, StatCard, ConnectorLine, AnimatedCTA, AnimatedHeader } from '@/components/HomeClientIslands';

export default function Home() {
    const stepData = [
        {
            step: 1,
            title: "Register & Pay",
            description: 'Create an account and pay just <span class="font-bold text-cyan-300">2 PKR</span> to enter the quiz competition',
            gradient: "bg-gradient-to-r from-blue-600/20 to-cyan-600/20",
            delay: 0,
            icon: "UserPlus"
        },
        {
            step: 2,
            title: "Answer Questions",
            description: 'Test your cricket knowledge with our challenging <span class="font-bold text-pink-300">tape ball cricket</span> questions',
            gradient: "bg-gradient-to-r from-purple-600/20 to-pink-600/20",
            delay: 0.15,
            icon: "BrainCircuit"
        },
        {
            step: 3,
            title: "Win Prizes",
            description: 'Random winners are selected after each quiz session to win <span class="font-bold text-yellow-300">exciting prizes</span>!',
            gradient: "bg-gradient-to-r from-green-600/20 to-yellow-600/20",
            delay: 0.3,
            icon: "Trophy"
        }
    ];

    const prizeData = [
        {
            icon: "Bike",
            title: "Bike",
            description: 'Win a brand new motorcycle worth <span class="font-bold text-orange-300">PKR 150,000+</span>',
            gradient: "bg-gradient-to-r from-red-500/20 to-orange-500/20",
            badge: "Grand Prize",
            delay: 0
        },
        {
            icon: "Smartphone",
            title: "Smartphone",
            description: 'Latest smartphone worth <span class="font-bold text-cyan-300">PKR 50,000+</span>',
            gradient: "bg-gradient-to-r from-blue-500/20 to-cyan-500/20",
            badge: "Premium Prize",
            delay: 0.15
        },
        {
            icon: "Headphones",
            title: "Wireless Earbuds",
            description: 'Premium wireless earbuds worth <span class="font-bold text-pink-300">PKR 15,000+</span>',
            gradient: "bg-gradient-to-r from-purple-500/20 to-pink-500/20",
            badge: "Popular Prize",
            delay: 0.3
        },
        {
            icon: "Watch",
            title: "Smart Watch",
            description: 'Advanced smartwatch worth <span class="font-bold text-emerald-300">PKR 25,000+</span>',
            gradient: "bg-gradient-to-r from-green-500/20 to-emerald-500/20",
            badge: "Tech Prize",
            delay: 0.45
        }
    ];

    const statsData = [
        { end: 1000, suffix: "+", label: "Active Players", color: "border-blue-400/20" },
        { end: 10000, suffix: "+", label: "Prizes Won", color: "border-purple-400/20" },
        { end: 500, suffix: "+", label: "Quizzes Taken", color: "border-green-400/20" },
        { end: null, display: "24/7", label: "Available", color: "border-yellow-400/20" }
    ];

    return (
        <div className="flex flex-col overflow-hidden">
            <HeroSection />

            {/* How It Works Section */}
            <LazySection
                className="py-20 bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-900 relative overflow-hidden"
                rootMargin="100px"
                delay={50}
            >
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/5 to-purple-500/5"></div>
                    <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-cyan-400/10 rounded-full blur-2xl"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-blue-400/10 rounded-full blur-2xl"></div>
                </div>

                {/* Connector line between steps */}
                <ConnectorLine />

                <div className="container mx-auto px-4 relative z-10">
                    <AnimatedHeader>
                        <h2 className="text-4xl md:text-6xl font-black mb-6">
                            <span className="bg-gradient-to-r from-white via-blue-200 to-cyan-300 bg-clip-text text-transparent">
                                How It Works
                            </span>
                        </h2>
                        <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                            Simple steps to start your cricket quiz journey and win amazing prizes
                        </p>
                    </AnimatedHeader>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {stepData.map((step) => (
                            <StepCard key={step.step} {...step} />
                        ))}
                    </div>
                </div>
            </LazySection>

            {/* Prize Showcase */}
            <LazySection
                className="py-20 bg-gradient-to-br from-gray-900 via-purple-900/10 to-gray-900 relative overflow-hidden"
                rootMargin="100px"
                delay={100}
            >
                <div className="absolute inset-0">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-l from-purple-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse"></div>
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-r from-blue-500/10 to-transparent rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
                </div>

                <div className="container mx-auto px-4 relative z-10">
                    <AnimatedHeader>
                        <h2 className="text-4xl md:text-6xl font-black mb-6">
                            <span className="bg-gradient-to-r from-yellow-300 via-orange-300 to-red-400 bg-clip-text text-transparent">
                                Amazing Prizes
                            </span>
                        </h2>
                        <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                            Win incredible prizes worth thousands of rupees in our cricket quiz competition
                        </p>
                    </AnimatedHeader>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
                        {prizeData.map((prize) => (
                            <PrizeCard key={prize.title} {...prize} />
                        ))}
                    </div>
                </div>
            </LazySection>

            {/* CTA Section */}
            <section className="py-20 bg-gradient-to-br from-blue-900 via-purple-900/30 to-blue-900 relative overflow-hidden">
                <div className="absolute inset-0">
                    <div className="absolute top-0 left-1/4 w-64 h-64 bg-gradient-to-r from-blue-400/10 to-cyan-400/10 rounded-full blur-3xl hidden md:animate-pulse"></div>
                    <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-gradient-to-l from-purple-400/10 to-pink-400/10 rounded-full blur-3xl hidden md:animate-pulse md:delay-1000"></div>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-cyan-400/5 to-blue-400/5 rounded-full blur-3xl hidden md:animate-pulse md:delay-500"></div>
                </div>

                <div className="absolute inset-0 md:hidden">
                    <div className="absolute top-0 left-1/4 w-32 h-32 bg-gradient-to-r from-blue-400/5 to-cyan-400/5 rounded-full"></div>
                    <div className="absolute bottom-0 right-1/4 w-32 h-32 bg-gradient-to-l from-purple-400/5 to-pink-400/5 rounded-full"></div>
                </div>

                <div className="container mx-auto px-4 text-center relative z-10">
                    <AnimatedCTA>
                        <div className="space-y-6">
                            <h2 className="text-4xl md:text-6xl font-black leading-tight">
                                <span className="bg-gradient-to-r from-white via-blue-100 to-cyan-200 bg-clip-text text-transparent">
                                    Ready to Test Your
                                </span>
                                <br />
                                <span className="bg-gradient-to-r from-cyan-200 via-blue-200 to-purple-200 bg-clip-text text-transparent">
                                    Cricket Knowledge?
                                </span>
                            </h2>
                            <p className="text-xl md:text-2xl text-gray-200 leading-relaxed max-w-2xl mx-auto">
                                Join thousands of cricket fans and compete for amazing prizes.
                                <span className="font-bold text-cyan-300"> Start your quiz journey today!</span>
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center pt-8">
                            <Link
                                href="/register"
                                className="group relative px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-2xl font-bold text-xl shadow-2xl transform transition-all duration-300 active:scale-95 sm:hover:scale-110 sm:hover:shadow-cyan-500/25 sm:hover:shadow-2xl touch-manipulation"
                            >
                                <span className="relative z-10 flex items-center gap-3">
                                    <span>🚀 Register Now</span>
                                    <span className="inline-block">→</span>
                                </span>
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl opacity-0 md:group-hover:opacity-100 transition-opacity duration-300"></div>
                            </Link>

                            <div className="flex items-center gap-4 text-gray-300">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-green-400 rounded-full hidden md:animate-pulse"></div>
                                    <span className="text-sm font-medium">Live Quiz Available</span>
                                </div>
                                <div className="w-px h-6 bg-gray-600"></div>
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl">🏆</span>
                                    <span className="text-sm font-medium">Win Big Prizes</span>
                                </div>
                            </div>
                        </div>

                        {/* Stats Section */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12 max-w-3xl mx-auto">
                            {statsData.map((stat) => (
                                <StatCard key={stat.label} {...stat} />
                            ))}
                        </div>
                    </AnimatedCTA>
                </div>
            </section>
        </div>
    );
}
