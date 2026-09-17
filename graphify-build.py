import json
from pathlib import Path
from graphify.extract import extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json

paths = [
  'src/app/profile/page.tsx',
  'src/app/profile/wallet/page.tsx',
  'src/app/profile/wallet/actions.ts',
  'src/components/profile/BalanceCard.tsx',
  'src/components/profile/ProfileAvatar.tsx',
  'src/components/profile/ProfileHeader.tsx',
  'src/components/profile/QuickActions.tsx',
  'src/components/profile/StatsGrid.tsx',
  'src/components/profile/ChangePasswordModal.tsx',
  'src/components/wallet/WalletDisplay.tsx',
  'src/components/wallet/DepositForm.tsx',
  'src/components/wallet/TransactionHistory.tsx',
  'src/types/wallet.ts',
]
paths = [Path(p) for p in paths if Path(p).exists()]
print(f'Extracting {len(paths)} files...')
result = extract(paths, cache_root=Path('.'))
n_nodes = len(result['nodes'])
n_edges = len(result['edges'])
print(f'AST: {n_nodes} nodes, {n_edges} edges')
Path('graphify-out/extraction.json').write_text(
    json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8'
)

# Build the graph
G = build_from_json(result)
communities = cluster(G)
cohesion = score_all(G, communities)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: f'Cluster {cid}' for cid in communities}
questions = suggest_questions(G, communities, labels)

# Manual labels (since we have no LLM for labeling)
LABELS = {
    0: 'Profile Page Container',
    1: 'Wallet Page Container',
    2: 'Wallet Sub-Components',
    3: 'Profile Sub-Components',
    4: 'Wallet Server Actions',
    5: 'Wallet Types & Models',
    6: 'Authentication Context',
}
labels = {cid: LABELS.get(cid, f'Cluster {cid}') for cid in communities}

tokens = {'input': 0, 'output': 0}
detection = {'total_files': len(paths), 'total_words': 0, 'files': {}}
report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, '.', suggested_questions=questions)
Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8')
to_json(G, communities, 'graphify-out/graph.json')
print(f'Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities')
print('Outputs: graphify-out/GRAPH_REPORT.md, graphify-out/graph.json')
