import Link from 'next/link';

export default function Footer() {
  return (
    <>
      {/* Simplified Background for Mobile Performance */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-blue-900/60 to-transparent"></div>
        {/* Simplified animated elements - only on larger screens */}
        <div className="absolute top-0 left-0 w-full h-full hidden md:block">
          <div className="absolute top-0 left-1/4 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl md:animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl md:animate-pulse" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-1/2 left-1/2 w-24 h-24 bg-blue-400/10 rounded-full blur-2xl hidden lg:block lg:animate-bounce" style={{ animationDuration: '4s' }}></div>
        </div>
        
        <footer className="relative bg-gray-900/80 md:backdrop-blur-xl md:bg-gradient-to-t md:from-gray-900/80 md:via-blue-900/40 md:to-gray-900/60 border-t border-white/10 shadow-lg md:shadow-2xl">
          <div className="container mx-auto px-4 py-12">
            
            {/* Main Footer Content */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
              
              {/* Company Info */}
              <div className="space-y-6">
                <div className="group">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="relative">
                      {/* Simplified glow effect - only on hover for larger screens */}
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full opacity-0 md:group-hover:opacity-50 transition-opacity duration-300 md:blur-lg"></div>
                      <div className="relative bg-gradient-to-r from-blue-600 to-purple-700 p-3 rounded-full border border-white/20 shadow-md md:shadow-lg">
                        <span className="text-white text-xl font-bold">🏏</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent">
                        1Think 2Win
                      </h3>
                      <p className="text-xs text-gray-400">Think Smart, Win Big</p>
                    </div>
                  </div>
                  {/* Simplified glass card - reduced blur on mobile */}
                  <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                    <p className="text-gray-300 text-sm leading-relaxed">
                      Test your cricket knowledge and win amazing prizes in our innovative quiz competition. 
                      Join thousands of smart thinkers in this exciting journey of knowledge and rewards!
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Quick Links */}
              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-white flex items-center space-x-2">
                  <span className="text-blue-400">🔗</span>
                  <span>Quick Links</span>
                </h4>
                {/* Simplified glass card */}
                <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                  <ul className="space-y-3">
                    {[
                      { href: '/', label: 'Home', icon: '🏠' },
                      { href: '/quizzes', label: 'Quizzes', icon: '📝' },
                      { href: '/prizes', label: 'Prizes', icon: '🏆' },
                      { href: '/leaderboard', label: 'Leaderboard', icon: '📊' }
                    ].map((item) => (
                      <li key={item.href}>
                        <Link 
                          href={item.href} 
                          className="group flex items-center space-x-3 text-gray-300 hover:text-white transition-colors duration-200 p-2 rounded-md hover:bg-white/10"
                        >
                          <span className="text-sm opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                            {item.icon}
                          </span>
                          <span className="text-sm font-medium">{item.label}</span>
                          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <span className="text-blue-400">→</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              {/* Support */}
              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-white flex items-center space-x-2">
                  <span className="text-green-400">💬</span>
                  <span>Support</span>
                </h4>
                {/* Simplified glass card */}
                <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4">
                  <ul className="space-y-3">
                    {[
                      { href: '/faq', label: 'FAQ', icon: '❓' },
                      { href: '/contact', label: 'Contact Us', icon: '📧' },
                      { href: '/disclaimer', label: 'Disclaimer', icon: '⚠️' },
                      { href: '/terms', label: 'Terms of Service', icon: '📋' },
                      { href: '/privacy', label: 'Privacy Policy', icon: '🔒' }
                    ].map((item) => (
                      <li key={item.href}>
                        <Link 
                          href={item.href} 
                          className="group flex items-center space-x-3 text-gray-300 hover:text-white transition-colors duration-200 p-2 rounded-md hover:bg-white/10"
                        >
                          <span className="text-sm opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                            {item.icon}
                          </span>
                          <span className="text-sm font-medium">{item.label}</span>
                          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <span className="text-green-400">→</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              {/* Contact Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-white flex items-center space-x-2">
                  <span className="text-purple-400">📞</span>
                  <span>Contact</span>
                </h4>
                {/* Simplified glass card */}
                <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-4 space-y-4">
                  
                  {/* Contact Details */}
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-white/5 transition-colors duration-200">
                      <span className="text-blue-400 mt-0.5">📧</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">Email</p>
                        <p className="text-sm text-white font-medium break-all">support@1think2win.com</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-white/5 transition-colors duration-200">
                      <span className="text-green-400 mt-0.5">📱</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">Phone</p>
                        <p className="text-sm text-white font-medium">+92 XXX XXXXXXX</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Social Links */}
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-xs text-gray-400 mb-3">Follow Us</p>
                    <div className="flex space-x-3">
                      {[
                        { name: 'Facebook', icon: '📘', color: 'hover:text-blue-400' },
                        { name: 'Twitter', icon: '🐦', color: 'hover:text-sky-400' },
                        { name: 'Instagram', icon: '📷', color: 'hover:text-pink-400' }
                      ].map((social) => (
                        <a
                          key={social.name}
                          href="#"
                          className={`group p-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 ${social.color} transition-colors duration-200 hover:bg-white/10 hover:border-white/20 md:hover:scale-110`}
                          title={social.name}
                        >
                          <span className="text-lg">{social.icon}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Newsletter Signup */}
            <div className="mb-8">
              {/* Simplified glass card */}
              <div className="bg-blue-500/10 md:backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 text-center">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center justify-center space-x-2">
                  <span>📬</span>
                  <span>Stay Updated</span>
                </h3>
                <p className="text-gray-300 text-sm mb-4">
                  Get the latest quiz updates, cricket news, and exclusive prizes delivered to your inbox!
                </p>
                <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    className="flex-1 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <button className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-500 hover:to-purple-500 transition-colors duration-200 shadow-md md:shadow-lg border border-white/20">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>
            
            {/* Bottom Bar */}
            <div className="border-t border-white/10 pt-8">
              {/* Simplified glass card */}
              <div className="bg-white/5 md:backdrop-blur-sm border border-white/10 rounded-lg p-6">
                <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                  <div className="text-center md:text-left">
                    <p className="text-gray-300 text-sm">
                      &copy; 2024 <span className="font-semibold text-white">1Think 2Win</span>. All rights reserved.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Crafted with ❤️ for cricket enthusiasts worldwide
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-green-500/20 border border-green-400/30">
                      <div className="w-2 h-2 bg-green-400 rounded-full md:animate-pulse"></div>
                      <span className="text-green-400 text-xs font-medium">Live</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      Made with <span className="text-red-400 md:animate-pulse">♥</span> by Antilights
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}