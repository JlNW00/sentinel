// ============================================================
// SENTINEL — Neo4j Investigation Query Templates
// ============================================================
// Used by the Entity Resolution System during investigations.
// Each query is labeled and documented for the agent to select.
// ============================================================

// ----- QUERY 1: All tokens deployed by a specific wallet -----
// Input: $walletAddress
MATCH (w:Wallet {address: $walletAddress})-[:DEPLOYED]->(t:Token)
RETURN t.mint AS mint, t.name AS name, t.risk_score AS risk_score, 
       t.status AS status, t.launched_at AS launched_at
ORDER BY t.launched_at DESC;

// ----- QUERY 2: All tokens by wallets connected to a known rug -----
// Input: $rugTokenMint — find all tokens by wallets linked to this rug
MATCH (rug:Token {mint: $rugTokenMint})<-[:DEPLOYED]-(deployer:Wallet)
MATCH (deployer)-[:FUNDED_BY|RECEIVED_FROM*1..3]-(linked:Wallet)
MATCH (linked)-[:DEPLOYED]->(other:Token)
WHERE other.mint <> $rugTokenMint
RETURN DISTINCT other.mint AS mint, other.name AS name, 
       other.risk_score AS risk_score, other.status AS status,
       linked.address AS via_wallet,
       length(shortestPath((deployer)-[:FUNDED_BY|RECEIVED_FROM*]-(linked))) AS hops
ORDER BY other.launched_at DESC;

// ----- QUERY 3: Funding chain from wallet A -----
// Input: $walletAddress — trace where funds came from (up to 5 hops)
MATCH path = (source:Wallet)-[:FUNDED_BY*1..5]->(target:Wallet {address: $walletAddress})
RETURN [n IN nodes(path) | n.address] AS funding_chain,
       [n IN nodes(path) | n.label] AS labels,
       length(path) AS hops
ORDER BY hops ASC
LIMIT 20;

// ----- QUERY 4: Cluster all wallets interacting with deployer within 24hrs -----
// Input: $deployerAddress, $launchTimestamp
MATCH (deployer:Wallet {address: $deployerAddress})-[r:FUNDED_BY|RECEIVED_FROM]-(connected:Wallet)
WHERE r.timestamp >= datetime($launchTimestamp) - duration('PT24H')
  AND r.timestamp <= datetime($launchTimestamp) + duration('PT24H')
RETURN connected.address AS wallet, connected.label AS label,
       type(r) AS relationship, r.amount_sol AS amount,
       r.timestamp AS timestamp
ORDER BY r.timestamp ASC;

// ----- QUERY 5: Known serial ruggers (wallets with 2+ rugged tokens) -----
MATCH (w:Wallet)-[:DEPLOYED]->(t:Token {status: 'RUGGED'})
WITH w, count(t) AS rug_count, collect(t.name) AS rugged_tokens
WHERE rug_count >= 2
RETURN w.address AS wallet, rug_count, rugged_tokens,
       w.first_seen AS first_seen, w.label AS label
ORDER BY rug_count DESC
LIMIT 50;

// ----- QUERY 6: Wallet cluster risk assessment -----
// Input: $clusterLabel
MATCH (c:Cluster {label: $clusterLabel})<-[:BELONGS_TO]-(w:Wallet)
OPTIONAL MATCH (w)-[:DEPLOYED]->(t:Token)
WITH c, collect(DISTINCT w.address) AS wallets, 
     count(DISTINCT t) AS total_tokens,
     count(DISTINCT CASE WHEN t.status = 'RUGGED' THEN t END) AS rugged_tokens,
     avg(t.risk_score) AS avg_risk_score
RETURN c.label AS cluster, c.risk_level AS risk_level,
       size(wallets) AS wallet_count, wallets[..5] AS sample_wallets,
       total_tokens, rugged_tokens, avg_risk_score;

// ----- QUERY 7: Find connected clusters (clusters sharing wallet connections) -----
// Input: $clusterLabel
MATCH (c1:Cluster {label: $clusterLabel})<-[:BELONGS_TO]-(w1:Wallet)
MATCH (w1)-[:FUNDED_BY|RECEIVED_FROM]-(w2:Wallet)-[:BELONGS_TO]->(c2:Cluster)
WHERE c1 <> c2
RETURN DISTINCT c2.label AS connected_cluster, c2.risk_level AS risk_level,
       count(DISTINCT w1) AS shared_connections
ORDER BY shared_connections DESC;

// ----- QUERY 8: Token investigation summary -----
// Input: $tokenMint — get full context for an investigation
MATCH (t:Token {mint: $tokenMint})<-[:DEPLOYED]-(deployer:Wallet)
OPTIONAL MATCH (deployer)-[:DEPLOYED]->(other:Token)
OPTIONAL MATCH (deployer)-[:FUNDED_BY]-(funder:Wallet)
OPTIONAL MATCH (deployer)-[:BELONGS_TO]->(cluster:Cluster)
OPTIONAL MATCH (t)<-[:PROFILED]-(dev:Developer)
RETURN t {.*, deployer: deployer.address} AS token,
       deployer {.*} AS deployer_info,
       collect(DISTINCT other {.mint, .name, .status, .risk_score}) AS other_tokens,
       collect(DISTINCT funder.address) AS funding_sources,
       cluster {.*} AS cluster_info,
       dev {.*} AS developer_info;

// ----- QUERY 9: Recent high-risk activity (dashboard query) -----
MATCH (t:Token)
WHERE t.risk_score >= 70 AND t.launched_at >= datetime() - duration('P7D')
OPTIONAL MATCH (t)<-[:DEPLOYED]-(w:Wallet)
RETURN t.mint AS mint, t.name AS name, t.risk_score AS risk_score,
       t.status AS status, t.launched_at AS launched_at,
       w.address AS deployer
ORDER BY t.risk_score DESC, t.launched_at DESC
LIMIT 25;

// ----- QUERY 10: Re-investigation candidates -----
// Tokens flagged but not yet confirmed — check for status changes
MATCH (t:Token)
WHERE t.status IN ['WATCHING', 'RED_FLAGS', 'HIGH_PROBABILITY']
  AND t.last_checked < datetime() - duration('PT6H')
RETURN t.mint AS mint, t.name AS name, t.risk_score AS risk_score,
       t.status AS status, t.last_checked AS last_checked
ORDER BY t.risk_score DESC;
