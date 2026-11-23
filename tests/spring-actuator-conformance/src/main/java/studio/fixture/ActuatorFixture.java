package studio.fixture;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.info.InfoContributor;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.web.server.WebFilter;

@SpringBootApplication
public class ActuatorFixture {
    public static void main(String[] args) {
        SpringApplication.run(ActuatorFixture.class, args);
    }

    @Bean
    HealthIndicator syntheticStatus(@Value("${fixture.down:false}") boolean down) {
        return () -> down ? Health.down().build() : Health.up().build();
    }

    @Bean
    InfoContributor syntheticInfo() {
        return builder -> builder.withDetail("fixture", Map.of("marker", "zicode-actuator-conformance"));
    }

    @Bean
    ApplicationListener<ApplicationReadyEvent> reportPort() {
        return event -> {
            var context = (WebServerApplicationContext) event.getApplicationContext();
            System.out.println("ZICODE_ACTUATOR_PORT " + context.getWebServer().getPort());
        };
    }

    @Bean
    WebFilter recordRequests() {
        return (exchange, chain) -> {
            var request = exchange.getRequest();
            System.out.println("ZICODE_ACTUATOR_REQUEST " + request.getMethod() + " " + request.getURI().getPath()
                    + " auth=" + request.getHeaders().containsKey("Authorization")
                    + " cookie=" + request.getHeaders().containsKey("Cookie"));
            return chain.filter(exchange);
        };
    }
}
