import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable shutdown hooks for graceful container termination (SIGTERM/SIGINT)
  app.enableShutdownHooks();

  const port = process.env.PORT || process.env.BACKEND_PORT || 3001;

  // Global DTO Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for frontend communication
  app.enableCors();

  await app.listen(port);
  console.log(`Backend server is running on port ${port}`);
}

bootstrap();
