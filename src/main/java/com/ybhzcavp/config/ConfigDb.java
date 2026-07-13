package com.ybhzcavp.config;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.stream.Collectors;

/**
 * 轻量 SQLite 配置库：路径 {@code app.config.db-path}，启动时执行 schema-config.sql。
 */
@Component
public class ConfigDb {

    private static final Logger log = LoggerFactory.getLogger(ConfigDb.class);

    private final AppProperties props;
    private Connection connection;

    public ConfigDb(AppProperties props) {
        this.props = props;
    }

    @PostConstruct
    public void init() {
        try {
            Path dbPath = Path.of(props.getConfig().getDbPath()).toAbsolutePath().normalize();
            Path parent = dbPath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Class.forName("org.sqlite.JDBC");
            connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
            connection.setAutoCommit(true);
            try (Statement pragma = connection.createStatement()) {
                pragma.execute("PRAGMA foreign_keys = ON");
            }
            applySchema();
            log.info("Config DB ready: {}", dbPath);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to init config DB", e);
        }
    }

    private void applySchema() throws Exception {
        ClassPathResource resource = new ClassPathResource("schema-config.sql");
        String sql;
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resource.getInputStream(), StandardCharsets.UTF_8))) {
            sql = reader.lines()
                    .map(String::trim)
                    .filter(line -> !line.isEmpty() && !line.startsWith("--"))
                    .collect(Collectors.joining("\n"));
        }
        try (Statement st = connection.createStatement()) {
            for (String stmt : sql.split(";")) {
                String trimmed = stmt.trim();
                if (!trimmed.isEmpty()) {
                    st.execute(trimmed);
                }
            }
        }
    }

    public Connection getConnection() {
        if (connection == null) {
            throw new IllegalStateException("Config DB not initialized");
        }
        return connection;
    }

    @PreDestroy
    public void close() {
        if (connection != null) {
            try {
                connection.close();
            } catch (SQLException e) {
                log.warn("Close config DB failed: {}", e.getMessage());
            }
        }
    }
}
