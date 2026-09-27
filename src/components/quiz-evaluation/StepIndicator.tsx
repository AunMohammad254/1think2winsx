// Step Indicator Component
export const StepIndicator = ({ currentStep }: { currentStep: number }) => {
    const steps = [
        { num: 1, label: 'Select Quiz', icon: '📋' },
        { num: 2, label: 'Set Answers', icon: '✏️' },
        { num: 3, label: 'Evaluate', icon: '📊' },
        { num: 4, label: 'Allocate Points', icon: '🏆' },
    ];

    return (
        <div className="flex items-center justify-between mb-8">
            {steps.map((step, index) => (
                <div key={step.num} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                        <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all duration-500 ${currentStep >= step.num
                                ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30 scale-110'
                                : 'bg-white/10 text-gray-400'
                                }`}
                        >
                            {step.icon}
                        </div>
                        <span
                            className={`mt-2 text-xs font-medium transition-colors duration-300 ${currentStep >= step.num ? 'text-blue-300' : 'text-gray-500'
                                }`}
                        >
                            {step.label}
                        </span>
                    </div>
                    {index < steps.length - 1 && (
                        <div className="flex-1 mx-2">
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className={`h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ${currentStep > step.num ? 'w-full' : 'w-0'
                                        }`}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
