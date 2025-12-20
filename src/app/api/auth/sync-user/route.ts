import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, email, name, phone, dateOfBirth } = body;

        if (!id || !email) {
            return NextResponse.json(
                { error: 'Missing required fields: id and email' },
                { status: 400 }
            );
        }

        // First, check if user exists by Supabase ID
        let existingUser = await prisma.user.findUnique({
            where: { id },
        });

        if (existingUser) {
            // User exists with this ID, update their info
            const user = await prisma.user.update({
                where: { id },
                data: {
                    email,
                    name: name || existingUser.name,
                    phone: phone || existingUser.phone,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : existingUser.dateOfBirth,
                    updatedAt: new Date(),
                },
            });
            return NextResponse.json({ success: true, user: { id: user.id, email: user.email } });
        }

        // Check if user exists by email (might have old cuid-based ID)
        existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            // User exists with this email but different ID
            // We need to update their ID to match Supabase UUID
            // This requires deleting and recreating to change the primary key
            // But first, we need to handle related records

            try {
                // Use a transaction to safely migrate the user
                const updatedUser = await prisma.$transaction(async (tx) => {
                    // Get all related data counts
                    const oldUserId = existingUser!.id;

                    // Update all related records to use new user ID
                    await tx.dailyPayment.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.quizAttempt.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.questionAttempt.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.payment.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.winning.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.prizeRedemption.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    await tx.answer.updateMany({
                        where: { userId: oldUserId },
                        data: { userId: id },
                    });

                    // Delete old user record
                    await tx.user.delete({
                        where: { id: oldUserId },
                    });

                    // Create new user with Supabase ID
                    const newUser = await tx.user.create({
                        data: {
                            id,
                            email,
                            name: name || existingUser!.name,
                            phone: phone || existingUser!.phone,
                            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : existingUser!.dateOfBirth,
                            points: existingUser!.points,
                            profilePicture: existingUser!.profilePicture,
                        },
                    });

                    return newUser;
                });

                return NextResponse.json({
                    success: true,
                    user: { id: updatedUser.id, email: updatedUser.email },
                    migrated: true
                });
            } catch (migrationError) {
                console.error('Error migrating user:', migrationError);
                // If migration fails, just return the existing user info
                return NextResponse.json({
                    success: true,
                    user: { id: existingUser.id, email: existingUser.email },
                    note: 'Using existing user record'
                });
            }
        }

        // User doesn't exist, create new
        const user = await prisma.user.create({
            data: {
                id,
                email,
                name: name || null,
                phone: phone || null,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            },
        });

        return NextResponse.json({ success: true, user: { id: user.id, email: user.email }, created: true });
    } catch (error) {
        console.error('Error syncing user:', error);
        return NextResponse.json(
            { error: 'Failed to sync user', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
