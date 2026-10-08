-- Add flag so we can exclude in-pit / in-lap / out-lap from review laps.
-- Set from TimingData: InPit or any Sectors[].Segments[].Status === 2064 (pit lane).
alter table timing_driver add column if not exists in_pit_segment boolean;
