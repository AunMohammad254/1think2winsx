import re

with open('src/app/quizzes/page.tsx', 'r') as f:
    content = f.read()

# 1. Add quizzesRef to QuizzesPageInner
ref_addition = """
  const quizzesRef = useRef(quizzes);
  useEffect(() => {
    quizzesRef.current = quizzes;
  }, [quizzes]);
"""

# Find the insertion point: right after `const [quizzes, setQuizzes] = useState<Quiz[]>([]);`
content = re.sub(r'(const \[quizzes, setQuizzes\] = useState<Quiz\[\]>\(\[\]\);)', r'\1\n' + ref_addition, content)


# 2. Update handleQuizClick to use quizzesRef.current and remove quizzes from dependency
old_handler = r"""  const handleQuizClick = useCallback\(\(quizId: string\) => \{
    const clicked = quizzes\.find\(q => q\.id === quizId\);
    if \(clicked\?\.status === 'upcoming'\) \{
      const when = clicked\.startsAt
        \? new Date\(clicked\.startsAt\)\.toLocaleString\(\[\], \{ dateStyle: 'medium', timeStyle: 'short' \}\)
        : 'soon';
      toast\.info\(`"\$\{clicked\.title\}" hasn't started yet\. It goes live \$\{when\}\.`\);
      return;
    \}
    if \(hasAccess\) \{
      liveQuizPushRef\.current\?\.open\(quizId\);
    \} else \{
      setShowPaymentModal\(true\);
    \}
  \}, \[quizzes, hasAccess\]\);"""

new_handler = """  const handleQuizClick = useCallback((quizId: string) => {
    const clicked = quizzesRef.current.find(q => q.id === quizId);
    if (clicked?.status === 'upcoming') {
      const when = clicked.startsAt
        ? new Date(clicked.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'soon';
      toast.info(`"${clicked.title}" hasn't started yet. It goes live ${when}.`);
      return;
    }
    if (hasAccess) {
      liveQuizPushRef.current?.open(quizId);
    } else {
      setShowPaymentModal(true);
    }
  }, [hasAccess]);"""

content = re.sub(old_handler, new_handler, content)

with open('src/app/quizzes/page.tsx', 'w') as f:
    f.write(content)
