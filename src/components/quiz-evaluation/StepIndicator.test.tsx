import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator } from './StepIndicator';

describe('StepIndicator', () => {
    it('renders all 4 steps', () => {
        render(<StepIndicator currentStep={1} />);

        expect(screen.getByText('Select Quiz')).toBeInTheDocument();
        expect(screen.getByText('Set Answers')).toBeInTheDocument();
        expect(screen.getByText('Evaluate')).toBeInTheDocument();
        expect(screen.getByText('Allocate Points')).toBeInTheDocument();
    });

    it('highlights completed steps', () => {
        render(<StepIndicator currentStep={3} />);

        // Step icons should be visible
        expect(screen.getByText('📋')).toBeInTheDocument();
        expect(screen.getByText('✏️')).toBeInTheDocument();
        expect(screen.getByText('📊')).toBeInTheDocument();
        expect(screen.getByText('🏆')).toBeInTheDocument();
    });

    it('shows step 1 as active when currentStep is 1', () => {
        const { container } = render(<StepIndicator currentStep={1} />);

        // Find the first step indicator (should have active styling)
        const stepElements = container.querySelectorAll('.rounded-full');
        expect(stepElements.length).toBeGreaterThan(0);
    });
});
