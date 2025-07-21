# Supavisor Pooler Configuration
# Configuration for PostgreSQL connection pooling

alias Supavisor.Tenants
alias Supavisor.Tenants.Cluster

# Create tenant for this instance
tenant_id = System.get_env("POOLER_TENANT_ID") || "default-tenant"
db_host = System.get_env("POSTGRES_HOST") || "db"
db_port = String.to_integer(System.get_env("POSTGRES_PORT") || "5432")
db_name = System.get_env("POSTGRES_DB") || "postgres"
db_user = "postgres"
db_password = System.get_env("POSTGRES_PASSWORD") || ""

# Pool configuration
default_pool_size = String.to_integer(System.get_env("POOLER_DEFAULT_POOL_SIZE") || "20")
max_client_conn = String.to_integer(System.get_env("POOLER_MAX_CLIENT_CONN") || "100")

# Create tenant if it doesn't exist
case Tenants.get_tenant_by_external_id(tenant_id) do
  nil ->
    # Create new tenant
    {:ok, tenant} = Tenants.create_tenant(%{
      external_id: tenant_id,
      name: "Instance #{tenant_id}",
      db_host: db_host,
      db_port: db_port,
      db_name: db_name,
      db_user: db_user,
      db_password: db_password,
      default_pool_size: default_pool_size,
      max_client_conn: max_client_conn,
      pool_mode: :transaction
    })
    
    IO.puts("✅ Created tenant: #{tenant_id}")
    
  tenant ->
    IO.puts("✅ Tenant already exists: #{tenant_id}")
end

# Create cluster configuration
case Tenants.get_cluster_by_tenant_and_type(tenant_id, :read_write) do
  nil ->
    {:ok, _cluster} = Tenants.create_cluster(%{
      tenant_external_id: tenant_id,
      type: :read_write,
      hostname: db_host,
      port: db_port,
      database: db_name,
      username: db_user,
      password: db_password,
      pool_size: default_pool_size,
      pool_mode: :transaction
    })
    
    IO.puts("✅ Created cluster for tenant: #{tenant_id}")
    
  _cluster ->
    IO.puts("✅ Cluster already exists for tenant: #{tenant_id}")
end

IO.puts("🔄 Supavisor pooler configuration completed")