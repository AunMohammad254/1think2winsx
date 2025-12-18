import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.answer.deleteMany();
  await prisma.quizAttempt.deleteMany();
  await prisma.question.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.user.deleteMany();

  // Create test user
  const hashedPassword = await bcrypt.hash('password123', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Test User',
      email: 'test@example.com',
      password: hashedPassword,
    },
  });

  // Create test quizzes
  const quiz1 = await prisma.quiz.create({
    data: {
      title: 'General Knowledge Quiz',
      description: 'Test your general knowledge with this fun quiz!',
    },
  });

  const quiz2 = await prisma.quiz.create({
    data: {
      title: 'Science Quiz',
      description: 'Challenge yourself with science questions!',
    },
  });

  // Create questions for quiz1
  await prisma.question.create({
    data: {
      quizId: quiz1.id,
      text: 'What is the capital of France?',
      options: JSON.stringify(['London', 'Berlin', 'Paris', 'Madrid']),
      correctOption: 2,
    },
  });

  await prisma.question.create({
    data: {
      quizId: quiz1.id,
      text: 'Which planet is known as the Red Planet?',
      options: JSON.stringify(['Venus', 'Mars', 'Jupiter', 'Saturn']),
      correctOption: 1,
    },
  });

  // Create questions for quiz2
  await prisma.question.create({
    data: {
      quizId: quiz2.id,
      text: 'What is the chemical symbol for water?',
      options: JSON.stringify(['H2O', 'CO2', 'NaCl', 'O2']),
      correctOption: 0,
    },
  });

  await prisma.question.create({
    data: {
      quizId: quiz2.id,
      text: 'How many bones are in the human body?',
      options: JSON.stringify(['206', '208', '210', '212']),
      correctOption: 0,
    },
  });

  console.log({ user, quiz1, quiz2 });
  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });