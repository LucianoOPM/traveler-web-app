-- Crea las tres bases de TravelTech (REC-001 y PEN-15).
-- PostgreSQL solo ejecuta este script cuando el volumen está vacío: para añadir una base a una
-- instalación existente hay que recrear el volumen (`docker compose down -v`, borra los datos).
CREATE DATABASE traveltech_private;
CREATE DATABASE traveltech_demo;
CREATE DATABASE traveltech_test;
