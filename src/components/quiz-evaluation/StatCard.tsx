// Stat Card Component
export const StatCard = ({
    icon,
    label,
    value,
    color = 'blue',
    animate = false,
}: {
    icon: string;
    label: string;
    value: string | number;
    color?: 'blue' | 'green' | 'yellow' | 'purple';
    animate?: boolean;
}) => {
    const colors = {
        blue: 'from-blue-500/20 to-blue-600/10 border-blue-400/30 text-blue-300',
        green: 'from-green-500/20 to-green-600/10 border-green-400/30 text-green-300',
        yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-400/30 text-yellow-300',
        purple: 'from-purple-500/20 to-purple-600/10 border-purple-400/30 text-purple-300',
    };

    return (
        <div
            className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${colors[color]} border p-4 transition-all duration-300 hover:scale-105 hover:shadow-lg`}
        >
            <div className={`text-3xl mb-2 ${animate ? 'animate-bounce' : ''}`}>{icon}</div>
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-sm opacity-80">{label}</div>
            <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/5 rounded-full" />
        </div>
    );
};
