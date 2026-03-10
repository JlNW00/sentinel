// ============================================================
// SENTINEL — Neo4j Knowledge Graph Schema Migration
// ============================================================
// Run once during setup: cat migration.cypher | cypher-shell -u neo4j -p <password>
// ============================================================

// --- CONSTRAINTS (unique identifiers) ---
CREATE CONSTRAINT wallet_address IF NOT EXISTS FOR (w:Wallet) REQUIRE w.address IS UNIQUE;
CREATE CONSTRAINT token_mint IF NOT EXISTS FOR (t:Token) REQUIRE t.mint IS UNIQUE;
CREATE CONSTRAINT developer_id IF NOT EXISTS FOR (d:Developer) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT cluster_id IF NOT EXISTS FOR (c:Cluster) REQUIRE c.id IS UNIQUE;

// --- INDEXES (query performance) ---
CREATE INDEX wallet_label IF NOT EXISTS FOR (w:Wallet) ON (w.label);
CREATE INDEX wallet_risk IF NOT EXISTS FOR (w:Wallet) ON (w.risk_level);
CREATE INDEX wallet_first_seen IF NOT EXISTS FOR (w:Wallet) ON (w.first_seen);
CREATE INDEX token_name IF NOT EXISTS FOR (t:Token) ON (t.name);
CREATE INDEX token_risk_score IF NOT EXISTS FOR (t:Token) ON (t.risk_score);
CREATE INDEX token_status IF NOT EXISTS FOR (t:Token) ON (t.status);
CREATE INDEX token_launched IF NOT EXISTS FOR (t:Token) ON (t.launched_at);
CREATE INDEX developer_credibility IF NOT EXISTS FOR (d:Developer) ON (d.credibility_score);
CREATE INDEX cluster_risk IF NOT EXISTS FOR (c:Cluster) ON (c.risk_level);

// --- SAMPLE DATA (for testing) ---
// Uncomment to seed test data:
// CREATE (w:Wallet {address: 'TEST_DEPLOYER_001', label: 'known_rugger', risk_level: 'HIGH', first_seen: datetime(), total_tokens_deployed: 5, total_rugs: 3})
// CREATE (t:Token {mint: 'TEST_TOKEN_001', name: 'TestRug', risk_score: 92, status: 'RUGGED', launched_at: datetime(), liquidity_usd: 50000})
// CREATE (w)-[:DEPLOYED {timestamp: datetime()}]->(t)
